-- The game simulation: App.tsx's step() loop and ability handlers, ported to
-- a pure-Lua module. It owns a state table, advances it with update(dt), and
-- reports side effects (sounds, saves, coins) as events for the view layer.
-- Time inside the sim is state.now, seconds of simulated time.
local layout = require("game.layout")
local combat = require("game.combat")
local skills = require("game.skills")
local upgrades = require("game.upgrades")
local inventory = require("game.inventory")
-- The world as Nicolai drew it: places and the roads between them, read out
-- of the guide by tools/build-routemap.mjs.
local routemap = require("game.routemap")

local M = {}

local SCREEN_W = layout.SCREEN_W
local PLAY_H = layout.PLAY_H

-- Seconds a cleared wave (or the start of the run) counts down before the next
-- wave launches on its own. The player can still start early with Next Wave.
-- Waves chain immediately once the previous wave has been cleared. The same
-- zero-delay launch waits behind checkpoint rewards and route selection.
M.WAVE_COUNTDOWN = 0
M.UPGRADE_EVERY_WAVES = 5
M.UPGRADE_REVEAL_DELAY = 1
M.MAPS_PER_ROUTE = 10

-- The opening: the road in before the princess wakes.
--
-- The route's first four maps are the story's beginning. Map 1 is stage 0 --
-- the doorstep the run opens on, where nothing is fought; the knight simply
-- stands there while the road is laid out. Stages 1 to 3 follow, three waves
-- each instead of five and single-file, with no fork until the awakening
-- heart is won at the end of stage 3. Through all of them the checkpoint
-- pays gold and gear only: a skill point would have nowhere to go until the
-- heart opens the skill tree.
--
-- So map_index and stage differ by exactly one, and stage is what the player
-- is shown.
M.OPENING_MAPS = 4
M.OPENING_WAVES_PER_MAP = 3

function M.stage_of_map(map_index) return map_index - 1 end

-- How long a given map is. Everything else derives from this, so a map's
-- length is stated in exactly one place.
function M.waves_in_map(map_index)
	if map_index <= 1 then return 0 end -- stage 0: a doorstep, not a battle
	if map_index <= M.OPENING_MAPS then return M.OPENING_WAVES_PER_MAP end
	return M.UPGRADE_EVERY_WAVES
end

-- Waves cleared before a map begins. Derived from map_index rather than
-- stored, so old saves keep working and nothing can drift out of step.
function M.waves_before_map(map_index)
	local total = 0
	for m = 1, map_index - 1 do total = total + M.waves_in_map(m) end
	return total
end

-- The wave number that completes a map -- the checkpoint.
function M.map_last_wave(map_index)
	return M.waves_before_map(map_index) + M.waves_in_map(map_index)
end

-- Whether this map belongs to the opening, and so withholds the skill point
-- and the upgrade card.
function M.is_opening_map(map_index)
	return map_index <= M.OPENING_MAPS
end

-- Measured clip lead times (assets/sounds/leads.json): how early each clip
-- must start so its loudest moment lands on the frame it belongs to.
M.CLIP_LEAD = {
	attack = { 0.0694, 0.0288, 0.0367 },
	kick = { 0.0972, 0.1754 },
	kill = { 0.062, 0.0443, 0.0356 },
	gore = { 0.1029, 0.1193, 0.129 },
}

local id_counters = { projectile = 0, flash = 0, mark = 0, lightning = 0, explosion = 0, blood = 0, corpse = 0, zone = 0, zcorpse = 0 }
local function next_id(kind)
	id_counters[kind] = id_counters[kind] + 1
	return id_counters[kind]
end

-- One upgrade per place on the drawn map. Nodes that share a stage are rolled
-- together so the three roads out of a fork offer three different things,
-- which is what made the old row of cards worth choosing between.
local function make_route_grid()
	local by_stage = {}
	for i, node in ipairs(routemap.nodes) do
		by_stage[node.stage] = by_stage[node.stage] or {}
		table.insert(by_stage[node.stage], i)
	end
	local grid = {}
	for stage, ids in pairs(by_stage) do
		local offers = upgrades.roll_offers(stage * M.UPGRADE_EVERY_WAVES)
		for k, id in ipairs(ids) do grid[id] = offers[((k - 1) % #offers) + 1] end
	end
	return grid
end

function M.new(game_state, opts)
	opts = opts or {}
	local gear = inventory.bonuses(opts.equipment)
	game_state.player.max_hp = game_state.player.max_hp + gear.max_health
	game_state.player.hp = math.min(game_state.player.max_hp,
		game_state.player.hp + (game_state.restored and 0 or gear.max_health))
	local s = {
		now = 0,
		player = game_state.player,
		abilities = game_state.abilities,
		upgrades = game_state.upgrades or {},
		gear_bonus = gear,
		-- Legacy direct offers remain supported for old saves/tests; current
		-- checkpoint upgrades live on route-grid nodes.
		pending_upgrade_offers = {},
		upgrade_offer_timer = nil,
		upgrade_offer_wave = nil,
		-- Per-skill progression belongs to this run and is mirrored into its
		-- resumable run save by the controller.
		skill_levels = opts.skill_levels or {},
		skill_xp = opts.skill_xp or {},
		wave = game_state.wave,
		map_index = game_state.map_index or math.floor((game_state.wave or 0) / M.UPGRADE_EVERY_WAVES) + 1,
		-- Where the knight stands on the drawn map, as an index into
		-- routemap.nodes. A save from before the map existed carries column
		-- numbers in its history, which mean nothing here, so it starts over
		-- on the doorstep rather than being read as a place.
		route_node = game_state.route_node or 1,
		route_history = game_state.route_node and game_state.route_history or { 1 },
		route_column = (game_state.route_column and game_state.route_column >= 1) and game_state.route_column or 2,
		route_grid = game_state.route_grid or make_route_grid(),
		route_pending = game_state.route_pending or game_state.upgrade_owed or false,
		mobs = {},
		allies = {},
		girl = {
			pos = { x = SCREEN_W / 2, y = combat.GIRL_POSITION_Y },
			hp = 100, max_hp = 100, radius = 14,
		},
		projectiles = {},
		hit_flashes = {},
		skill_marks = {},
		lightning_links = {},
		explosions = {},
		blood = {},
		corpses = {},
		zombie_corpses = {},
		drain_channel = nil,
		drain_links = {},
		cone_zones = {},
		cone_hits = {},
		floating_texts = {},
		ground_items = {},
		wave_queues = {},
		loot_owed = {},
		wave_active = false,
		-- Seconds until the next wave auto-launches. Set at run start and
		-- after each cleared wave; ticks only once the intro is done and no
		-- upgrade offer is waiting. nil means "not counting down".
		wave_countdown = M.WAVE_COUNTDOWN,
		game_over = false,
		aiming_slot = nil,
		aim_point = nil,
		-- animation chain scratch
		die_timer = nil,
		pending_cast_anim = nil,
		hurt_anim_gap = 0,
		swing_sound_timer = 0,
		swing_sound_name = nil,
		swing_gore_pos = nil,
		kick_shove_timer = 0,
		kick_sound_timer = 0,
		kick_sound_name = nil,
		footstep_step = nil,
		-- run bookkeeping
		run_id = opts.run_id,
		is_test_run = opts.is_test_run or false,
		highest_wave_cleared = game_state.wave or 0,
		events = {},
	}
	return s
end

local function emit(s, ev)
	s.events[#s.events + 1] = ev
end

function M.make_save(s)
	return {
		id = s.run_id,
		saved_at = os.time(),
		wave = s.highest_wave_cleared,
		hp = s.player.hp,
		max_hp = s.player.max_hp,
		abilities = s.abilities,
		upgrades = s.upgrades,
		map_index = s.map_index,
		route_node = s.route_node,
		route_column = s.route_column,
		route_history = s.route_history,
		route_grid = s.route_grid,
		route_pending = s.route_pending,
		upgrade_owed = false,
	}
end

function M.take_events(s)
	local evs = s.events
	s.events = {}
	return evs
end

-- The equipped level of a skill sitting in an active slot, or 0.
local function equipped_level_of(s, skill)
	for k = 1, 3 do
		if s.abilities[k].skill == skill then return s.abilities[k].level end
	end
	return 0
end
M.equipped_level_of = equipped_level_of

-- Cooldowns shrink with the Spellcaster upgrade; clamped so a pile of them
-- cannot reach a zero or negative cooldown.
local function cd_scale(s)
	return math.max(0.1, 1 - upgrades.bonuses(s.upgrades).cooldown - s.gear_bonus.cooldown)
end

local function ability_power(s)
	return 1 + upgrades.bonuses(s.upgrades).ability_power + s.gear_bonus.ability_power
end

local function keep_outside(pos, center, min_distance, fallback_x, fallback_y)
	local dx, dy = pos.x - center.x, pos.y - center.y
	local d = math.sqrt(dx * dx + dy * dy)
	if d >= min_distance then return pos end
	if d < 0.001 then
		dx, dy = fallback_x or 0, fallback_y or -1
		d = math.sqrt(dx * dx + dy * dy)
		if d < 0.001 then dx, dy, d = 0, -1, 1 end
	end
	return {
		x = center.x + dx / d * min_distance,
		y = center.y + dy / d * min_distance,
	}
end

-- Vampire and the active Berserker buff heal the player for a fraction of
-- damage dealt, capped at their normal max HP.
local function apply_lifesteal(s, dmg)
	local ls = upgrades.bonuses(s.upgrades).lifesteal + s.gear_bonus.lifesteal
	if s.player.haste_timer > 0 and equipped_level_of(s, "ranged") > 0 then
		ls = ls + skills.BERSERKER_LIFESTEAL
	end
	if ls <= 0 or dmg <= 0 or s.die_timer ~= nil then return end
	s.player.hp = math.min(s.player.max_hp, s.player.hp + dmg * ls)
end

-- Every friendly impact damages the whole nearby pack. Enemy attack paths do
-- not call this helper, so their melee strikes and projectiles remain strictly
-- single-target.
local function friendly_splash(s, center, damage, skill, now, hit_ids)
	local bonus = upgrades.bonuses(s.upgrades)
	local radius = combat.FRIENDLY_SPLASH_RADIUS * (1 + (bonus.splash or 0))
	local killed = false
	for _, m in ipairs(s.mobs) do
		if m.hp > 0 and (not hit_ids or not hit_ids[m.id])
			and combat.dist(center, m.pos) <= radius + m.radius then
			m.hp = m.hp - damage
			m.last_hit_skill = skill
			combat.hurt_mob(m, center)
			if hit_ids then hit_ids[m.id] = true end
			killed = killed or m.hp <= 0
			s.hit_flashes[#s.hit_flashes + 1] = {
				id = next_id("flash"), pos = { x = m.pos.x, y = m.pos.y }, created_at = now,
				color = skill == "fireball" and { 1, 0.12, 0.06 } or nil,
				size = skill == "fireball" and 28 or nil,
			}
			s.floating_texts[#s.floating_texts + 1] = combat.make_floating_text(("-%d"):format(math.floor(damage + 0.5)), m.pos, combat.DAMAGE_TEXT_COLOR, now)
		end
	end
	return killed
end

-- Queue the cone's blows onto the travelling wave (or land at once when the
-- ride flag is off). Who is hit and for how much was settled by fire_cone.
local function queue_cone_hits(s, hits, origin)
	for _, h in ipairs(hits) do
		local travel = 0
		if skills.CONE_DAMAGE_RIDES_WAVE then
			travel = skills.RUPTURE_ZONE_DELAY + combat.dist(origin, h.pos) / skills.CONE_ZONE.sweep_speed
		end
		s.cone_hits[#s.cone_hits + 1] = { mob_id = h.id, amount = h.amount, at = s.now + travel }
		s.skill_marks[#s.skill_marks + 1] = {
			id = next_id("mark"), pos = { x = h.pos.x, y = h.pos.y }, radius = 22,
			color = skills.SKILL_META.cone.color, created_at = s.now + travel,
		}
	end
end

local function add_cone_zone(s, origin, angle_deg)
	s.cone_zones[#s.cone_zones + 1] = {
		id = next_id("zone"), x = origin.x, y = origin.y, angle_deg = angle_deg,
		start_at = s.now + skills.RUPTURE_ZONE_DELAY,
	}
end

-- Fire the cone from an explicit aim point (the aimed release path).
function M.cast_cone_aimed(s, slot, point)
	local p = s.player
	local ab = s.abilities[slot]
	s.aiming_slot = nil
	s.aim_point = nil
	if s.die_timer ~= nil or ab.skill ~= "cone" then return end
	if s.drain_channel then
		s.drain_channel = nil
		s.drain_links = {}
	end
	s.pending_cast_anim = "rupture"
	-- The cast plants him: a cone loosed on the move stops the walk so the
	-- pose (and the shockwave under it) fire from where he stood.
	p.target = nil
	add_cone_zone(s, p.pos, math.atan2(point.y - p.pos.y, point.x - p.pos.x) * 180 / math.pi)
	local hits = skills.fire_cone(p.pos, point, s.mobs,
		skills.ability2_base_damage(ab.level) * ability_power(s), 0,
		skills.CONE_RANGE, skills.ABILITY2_HALF_ANGLE_DEG)
	queue_cone_hits(s, hits, p.pos)
	ab.cooldown = skills.SKILL_META.cone.cooldown * cd_scale(s)
end

function M.press_ability(s, slot)
	if s.game_over or s.die_timer ~= nil then return end
	local ab = s.abilities[slot]
	local p = s.player
	local skill = ab.skill
	if not skill or ab.level <= 0 or ab.cooldown > 0 then return end
	-- Casting anything (Drain Life's own recast included) breaks a channel.
	if s.drain_channel then
		s.drain_channel = nil
		s.drain_links = {}
	end

	if skill == "summon" then
		-- Dead Again: resummon the oldest corpse within range as a weaker,
		-- time-limited zombie -- consuming it.
		local sh = 1 + upgrades.bonuses(s.upgrades).summon_health + s.gear_bonus.summon_health
		local ap = ability_power(s)
		local best, best_i = nil, nil
		for i, c in ipairs(s.zombie_corpses) do
			if combat.dist(p.pos, c.pos) <= skills.DEAD_AGAIN_RANGE then
				if not best or c.age > best.age then best, best_i = c, i end
			end
		end
		if not best then return end
		table.remove(s.zombie_corpses, best_i)
		s.pending_cast_anim = "ancestor"
		local st = skills.ability1_stats(ab.level)
		local ally = combat.make_custom_ally(best.pos, {
			hp = math.floor(st.hp / 2 * sh),
			damage = st.damage / 2 * ap,
			level = ab.level,
			source_skill = "summon",
			expire_timer = skills.DEAD_AGAIN_DURATION,
		})
		s.allies[#s.allies + 1] = ally
	elseif skill == "seagull" then
		-- The Cure: charm the nearest non-boss enemy to fight for you a while.
		local candidates = {}
		for _, m in ipairs(s.mobs) do
			if m.hp > 0 and combat.base_mob_type(m.type) ~= "boss" then
				candidates[#candidates + 1] = { kind = "mob", id = m.id, pos = m.pos }
			end
		end
		local target = skills.nearest_target(p.pos, candidates, skills.CURE_RANGE)
		if not target then return end
		local mob
		local survivors = {}
		for _, m in ipairs(s.mobs) do
			if m.id == target.id then mob = m else survivors[#survivors + 1] = m end
		end
		s.mobs = survivors
		s.pending_cast_anim = "ancestor"
		local charmed = combat.make_custom_ally(mob.pos, {
			hp = mob.hp,
			max_hp = mob.max_hp,
			damage = mob.damage,
			source_skill = "seagull",
			expire_timer = skills.CURE_DURATION,
		})
		s.allies[#s.allies + 1] = charmed
	elseif skill == "monsterzombie" then
		-- Fuse every Dead Again zombie into one, briefly, at their combined
		-- current HP and attack damage.
		local total_hp, total_dmg = 0, 0
		local survivors = {}
		local any = false
		for _, a in ipairs(s.allies) do
			if a.source_skill == "summon" and a.hp > 0 then
				total_hp = total_hp + a.hp
				total_dmg = total_dmg + a.damage
				any = true
			else
				survivors[#survivors + 1] = a
			end
		end
		if not any then return end
		s.allies = survivors
		s.pending_cast_anim = "ancestor"
		local fused = combat.make_custom_ally(p.pos, {
			hp = total_hp,
			damage = total_dmg,
			level = ab.level,
			source_skill = "summon",
			expire_timer = skills.MONSTER_ZOMBIE_DURATION,
		})
		s.allies[#s.allies + 1] = fused
	elseif skill == "cone" then
		s.pending_cast_anim = "rupture"
		-- Same rule as the aimed cast: casting the shockwave stops the walk.
		p.target = nil
		-- Auto-aim: point the shockwave at the nearest enemy, turning to face
		-- it; with none around, fall back to whichever way he already faces.
		local nearest, best = nil, math.huge
		for _, m in ipairs(s.mobs) do
			if m.hp > 0 then
				local d = combat.dist(m.pos, p.pos)
				if d < best then best = d; nearest = m end
			end
		end
		local aim
		if nearest then
			aim = { x = nearest.pos.x, y = nearest.pos.y }
			p.facing = combat.facing_from_delta(nearest.pos.x - p.pos.x, nearest.pos.y - p.pos.y)
		else
			local dir = combat.direction_from_facing(p.facing)
			aim = { x = p.pos.x + dir.x * skills.CONE_RANGE, y = p.pos.y + dir.y * skills.CONE_RANGE }
		end
		local splash = 1 + upgrades.bonuses(s.upgrades).splash
		add_cone_zone(s, p.pos, math.atan2(aim.y - p.pos.y, aim.x - p.pos.x) * 180 / math.pi)
		local hits = skills.fire_cone(p.pos, aim, s.mobs,
			skills.ability2_base_damage(ab.level) * ability_power(s), 0,
			skills.CONE_RANGE * splash, skills.ABILITY2_HALF_ANGLE_DEG)
		queue_cone_hits(s, hits, p.pos)
	elseif skill == "ranged" then
		-- Berserker's active: a burst of attack speed (the health/regen is a
		-- passive handled in update).
		p.haste_timer = skills.ABILITY3_HASTE_DURATION
	elseif skill == "fireball" then
		-- Fire Enrage: faster attacks plus level-scaled fire damage on each hit.
		local any = false
		for _, a in ipairs(s.allies) do
			if a.hp > 0 then
				a.enrage_timer = skills.FIREBALL_ENRAGE_DURATION
				a.enrage_damage = skills.fireball_attack_damage(ab.level) * ability_power(s)
				any = true
			end
		end
		if not any then return end
	elseif skill == "burn" then
		-- Fireball: a projectile at the nearest enemy that explodes on impact.
		local target, best = nil, math.huge
		for _, m in ipairs(s.mobs) do
			if m.hp > 0 then
				local d = combat.dist(p.pos, m.pos)
				if d < best then target, best = m, d end
			end
		end
		if not target then return end
		s.projectiles[#s.projectiles + 1] = {
			id = next_id("projectile"),
			from = { x = p.pos.x, y = p.pos.y },
			to = { x = target.pos.x, y = target.pos.y },
			created_at = s.now,
			duration = math.max(0.08, best / combat.PROJECTILE_SPEED),
			color = skills.SKILL_META.burn.color,
			damage = 0,
			friendly = true,
			target_kind = "mob",
			target_id = target.id,
			skill = "burn",
			explode_damage = skills.burn_explode_damage(ab.level) * ability_power(s),
		}
	elseif skill == "drainlife" then
		-- Channel: no target needed, just plants him for the duration.
		p.target = nil
		s.pending_cast_anim = nil
		s.drain_channel = { time_left = skills.DRAIN_LIFE_DURATION, level = ab.level }
		s.drain_links = {}
	elseif skill == "stomp" then
		local dmg = skills.stomp_damage(ab.level) * ability_power(s)
		local any = false
		for _, m in ipairs(s.mobs) do
			if m.hp > 0 and combat.dist(p.pos, m.pos) <= skills.STOMP_RADIUS + m.radius then
				m.hp = m.hp - dmg
				m.last_hit_skill = "stomp"
				m.stun_timer = skills.STOMP_STUN_DURATION
				s.hit_flashes[#s.hit_flashes + 1] = { id = next_id("flash"), pos = { x = m.pos.x, y = m.pos.y }, created_at = s.now }
				s.floating_texts[#s.floating_texts + 1] = combat.make_floating_text(("-%d"):format(math.floor(dmg + 0.5)), m.pos, combat.DAMAGE_TEXT_COLOR, s.now)
				any = true
			end
		end
		s.skill_marks[#s.skill_marks + 1] = {
			id = next_id("mark"), pos = { x = p.pos.x, y = p.pos.y },
			radius = skills.STOMP_RADIUS, color = skills.SKILL_META.stomp.color, created_at = s.now,
		}
		if not any then return end
	elseif skill == "chainlightning" then
		local origin = { x = p.pos.x, y = p.pos.y }
		local hit_ids = {}
		local damage = skills.chain_lightning_damage(ab.level) * ability_power(s)
		local hit_count = 0
		for jump = 1, skills.chain_lightning_hits(ab.level) do
			local target, best = nil, math.huge
			local max_range = jump == 1 and skills.CHAIN_LIGHTNING_CAST_RANGE
				or skills.CHAIN_LIGHTNING_JUMP_RANGE
			for _, m in ipairs(s.mobs) do
				if m.hp > 0 and not hit_ids[m.id] then
					local d = combat.dist(origin, m.pos)
					if d <= max_range + m.radius and d < best then target, best = m, d end
				end
			end
			if not target then break end
			s.lightning_links[#s.lightning_links + 1] = {
				id = next_id("lightning"),
				from = { x = origin.x, y = origin.y },
				to = { x = target.pos.x, y = target.pos.y },
				created_at = s.now,
			}
			hit_ids[target.id] = true
			target.hp = target.hp - damage
			target.last_hit_skill = "chainlightning"
			combat.hurt_mob(target)
			s.hit_flashes[#s.hit_flashes + 1] = {
				id = next_id("flash"), pos = { x = target.pos.x, y = target.pos.y }, created_at = s.now,
			}
			s.skill_marks[#s.skill_marks + 1] = {
				id = next_id("mark"), pos = { x = target.pos.x, y = target.pos.y },
				radius = 18, color = skills.SKILL_META.chainlightning.color, created_at = s.now,
			}
			s.floating_texts[#s.floating_texts + 1] = combat.make_floating_text(
				("-%d"):format(math.floor(damage + 0.5)), target.pos, combat.DAMAGE_TEXT_COLOR, s.now)
			origin = { x = target.pos.x, y = target.pos.y }
			damage = damage * skills.CHAIN_LIGHTNING_FALLOFF
			hit_count = hit_count + 1
		end
		if hit_count == 0 then return end
	elseif skill == "swordthrow" then
		local target, best = nil, math.huge
		for _, m in ipairs(s.mobs) do
			if m.hp > 0 then
				local d = combat.dist(p.pos, m.pos)
				if d <= skills.SWORD_THROW_RANGE + m.radius and d < best then
					target, best = m, d
				end
			end
		end
		if not target then return end
		s.projectiles[#s.projectiles + 1] = {
			id = next_id("projectile"),
			from = { x = p.pos.x, y = p.pos.y },
			to = { x = target.pos.x, y = target.pos.y },
			created_at = s.now,
			duration = math.max(0.08, best / combat.PROJECTILE_SPEED),
			color = skills.SKILL_META.swordthrow.color,
			damage = (combat.PLAYER_BASE_DAMAGE + upgrades.bonuses(s.upgrades).attack_damage + s.gear_bonus.attack_damage)
				* skills.sword_throw_percent(ab.level) * ability_power(s),
			friendly = true,
			target_kind = "mob",
			target_id = target.id,
			skill = "swordthrow",
			bounce_hit_ids = { [target.id] = true },
		}
	elseif skill == "push" then
		local dmg = skills.push_damage_percent(ab.level)
			* (combat.PLAYER_BASE_DAMAGE + upgrades.bonuses(s.upgrades).attack_damage + s.gear_bonus.attack_damage) * ability_power(s)
		for _, m in ipairs(s.mobs) do
			local dx = m.pos.x - p.pos.x
			local dy = m.pos.y - p.pos.y
			local d = math.sqrt(dx * dx + dy * dy)
			if d <= skills.PUSH_RANGE + m.radius then
				if d == 0 then d = 1 end
				s.hit_flashes[#s.hit_flashes + 1] = { id = next_id("flash"), pos = { x = m.pos.x, y = m.pos.y }, created_at = s.now }
				s.floating_texts[#s.floating_texts + 1] = combat.make_floating_text(("-%d"):format(math.floor(dmg + 0.5)), m.pos, combat.DAMAGE_TEXT_COLOR, s.now)
				m.hp = m.hp - dmg
				m.last_hit_skill = "push"
				m.knock = { x = dx / d * skills.PUSH_SPEED, y = dy / d * skills.PUSH_SPEED }
				apply_lifesteal(s, dmg)
			end
		end
		s.skill_marks[#s.skill_marks + 1] = {
			id = next_id("mark"), pos = { x = p.pos.x, y = p.pos.y },
			radius = skills.PUSH_RANGE, color = skills.SKILL_META.push.color, created_at = s.now,
		}
	end

	ab.cooldown = skills.SKILL_META[skill].cooldown * cd_scale(s)
end

function M.can_start_next_wave(s)
	if s.game_over or s.route_pending or s.upgrade_offer_timer ~= nil or #s.pending_upgrade_offers > 0 then return false end
	local closing = M.map_last_wave(s.map_index)
	for _, wave in ipairs(s.loot_owed) do
		if wave == closing then return false end
	end
	return true
end

function M.local_wave(s)
	if s.wave <= 0 then return 0 end
	return s.wave - M.waves_before_map(s.map_index)
end

function M.route_row(s)
	return ((s.map_index - 1) % M.MAPS_PER_ROUTE) + 1
end

-- Which places the knight can walk to from where he stands: the ones a road
-- reaches that lie one stage further on. The drawing decides -- a single file
-- through the opening, three ways out of the awakening heart, crossings after
-- that -- so the shape of the journey is redrawn, never recoded.
function M.route_choices(s)
	local here = s.route_node or 1
	local node = routemap.nodes[here]
	if not node then return {} end
	local out = {}
	for _, road in ipairs(routemap.roads) do
		local other = (road.from == here and road.to)
			or (road.to == here and road.from) or nil
		local n = other and routemap.nodes[other]
		if n and n.stage == node.stage + 1 then out[#out + 1] = other end
	end
	table.sort(out)
	return out
end

-- The world ends where the drawing ends: when no road leads on, there is no
-- map to open and the waves simply keep coming.
function M.route_has_next(s) return #M.route_choices(s) > 0 end

function M.route_choice_count(s) return #M.route_choices(s) end

-- What a place on the map pays when the knight arrives. Opening places hold
-- nothing, so their faces name the stage instead of a card and the road
-- reads as a road rather than a shop.
function M.route_node_upgrade(s, node_id)
	local node = routemap.nodes[node_id]
	if not node or M.is_opening_map(node.stage + 1) then return nil end
	return s.route_grid and s.route_grid[node_id] or nil
end

local function reset_map_field(s)
	local p = combat.make_player()
	p.max_hp = p.max_hp + s.gear_bonus.max_health
	p.hp = p.max_hp
	s.player = p
	s.girl = {
		pos = { x = SCREEN_W / 2, y = combat.GIRL_POSITION_Y },
		hp = 100, max_hp = 100, radius = 14,
	}
	for _, key in ipairs({
		"mobs", "allies", "projectiles", "hit_flashes", "skill_marks",
		"lightning_links", "explosions", "blood", "corpses", "zombie_corpses",
		"drain_links", "cone_zones",
		"cone_hits", "floating_texts", "ground_items", "wave_queues", "loot_owed",
	}) do s[key] = {} end
	s.drain_channel = nil
	for _, ability in ipairs(s.abilities) do ability.cooldown = 0 end
	s.wave_active = false
	s.aiming_slot = nil
	s.aim_point = nil
	s.die_timer = nil
	s.pending_cast_anim = nil
	s.hurt_anim_gap = 0
	s.swing_sound_timer = 0
	s.swing_sound_name = nil
	s.swing_gore_pos = nil
	s.kick_shove_timer = 0
	s.kick_sound_timer = 0
	s.kick_sound_name = nil
	s.footstep_step = nil
end

function M.choose_route(s, target_node)
	if not s.route_pending then return false end
	local allowed = false
	for _, id in ipairs(M.route_choices(s)) do
		if id == target_node then allowed = true break end
	end
	if not allowed then return false end
	-- Stepping onto an opening place earns no upgrade card: those begin with
	-- the awakening. The map leaves those nodes empty to say so.
	local picked = M.route_node_upgrade(s, target_node)
	if picked then s.upgrades[#s.upgrades + 1] = picked end
	s.route_history[#s.route_history + 1] = target_node
	s.route_node = target_node
	-- The stage is the drawing's, and the map index trails it by one, so all
	-- the wave arithmetic keeps counting the way it always has.
	s.map_index = routemap.nodes[target_node].stage + 1
	s.route_pending = false
	reset_map_field(s)
	s.wave_countdown = M.WAVE_COUNTDOWN
	if not s.is_test_run and s.run_id then
		emit(s, { type = "autosave", save = M.make_save(s) })
	end
	return true
end

function M.start_next_wave(s)
	if not M.can_start_next_wave(s) then return false end
	s.wave_countdown = nil -- launching now cancels any pending auto-launch
	s.wave = s.wave + 1
	local types = combat.build_wave_queue(s.wave)
	s.wave_queues[#s.wave_queues + 1] = {
		wave = s.wave, types = types, timer = 0,
		spawned = 0,
		interval = combat.WAVE_SPAWN_WINDOW / math.max(1, #types),
	}
	s.wave_active = true
	s.loot_owed[#s.loot_owed + 1] = s.wave
	return true
end

-- Tap on the play field: order a move (or aim the cone).
function M.tap_field(s, x, y)
	if s.game_over or s.die_timer ~= nil then return end
	if s.aiming_slot then
		s.aim_point = { x = x, y = y }
		return
	end
	if s.player.intro_phase ~= "done" then return end
	if #s.pending_upgrade_offers > 0 then return end -- must answer the offer first
	s.player.target = {
		x = math.max(combat.PLAYER_RADIUS, math.min(SCREEN_W - combat.PLAYER_RIGHT_BUFFER - combat.PLAYER_RADIUS, x)),
		y = math.max(combat.PLAYER_RADIUS + combat.PLAYER_TOP_BUFFER,
			math.min(PLAY_H - combat.PLAYER_RADIUS, y)),
	}
	s.player.target = keep_outside(s.player.target, s.girl.pos,
		combat.PLAYER_RADIUS + s.girl.radius,
		s.player.pos.x - s.girl.pos.x, s.player.pos.y - s.girl.pos.y)
end

-- Answer the oldest pending upgrade offer, picking one of its three choices.
-- The other two are discarded; the pick is permanent for the run.
function M.choose_upgrade(s, choice_index)
	local offers = s.pending_upgrade_offers
	if #offers == 0 then return end
	local set = offers[1]
	local picked = set[choice_index]
	if not picked then return end
	table.remove(offers, 1)
	s.upgrades[#s.upgrades + 1] = picked
end

-- Per-skill progression, from two income streams so a skill still ranks up
-- even if it never personally lands a kill: half from landing kills with it
-- equipped, half from simply clearing waves with it equipped. Skill points
-- unlock rank 1 in the tree; every rank after that is earned here. Levels are
-- run-specific, so it is preserved by Continue but reset after death.
local KILL_XP = 20
local WAVE_CLEAR_XP = 20

local function is_skill_equipped(s, sid)
	for k = 1, 3 do
		if s.abilities[k].skill == sid then return true end
	end
	return false
end

local function add_skill_xp(s, sid, amount, pos)
	local level = s.skill_levels[sid] or 0
	if level <= 0 or level >= skills.ABILITY_MAX_LEVEL then return end
	local needed = skills.skill_xp_to_next(level)
	if not needed then return end
	-- Grinder upgrade: more experience on all skills.
	amount = math.floor(amount * (1 + upgrades.bonuses(s.upgrades).xp) + 0.5)
	s.skill_xp[sid] = (s.skill_xp[sid] or 0) + amount
	local leveled = false
	while s.skill_xp[sid] >= needed and level < skills.ABILITY_MAX_LEVEL do
		s.skill_xp[sid] = s.skill_xp[sid] - needed
		level = level + 1
		leveled = true
		needed = skills.skill_xp_to_next(level)
		if not needed then break end
	end
	if leveled then
		s.skill_levels[sid] = level
		for k = 1, 3 do
			if s.abilities[k].skill == sid then s.abilities[k].level = level end
		end
		if pos then
			s.floating_texts[#s.floating_texts + 1] =
				combat.make_floating_text(skills.SKILL_META[sid].label .. " Lv " .. level, pos, { 1, 0.835, 0.31 }, s.now)
		end
	end
	emit(s, { type = "skill_progress", skill = sid, level = s.skill_levels[sid], xp = s.skill_xp[sid] })
end

local function grant_skill_kill_xp(s, sid, pos)
	if not is_skill_equipped(s, sid) then return end
	add_skill_xp(s, sid, KILL_XP, pos)
end

-- Every equipped active skill earns its wave-clear share, regardless of
-- whether it personally landed a blow this wave.
local function grant_wave_clear_xp(s)
	for k = 1, 3 do
		local sid = s.abilities[k].skill
		if sid then add_skill_xp(s, sid, WAVE_CLEAR_XP, s.player.pos) end
	end
end

-- One tick. Everything in App.tsx's step(), in the same order.
function M.update(s, dt)
	if s.game_over then return end
	s.now = s.now + dt
	local now = s.now
	local p = s.player

	local bonus = upgrades.bonuses(s.upgrades)
	local damage_to_player = 0
	local damage_to_girl = 0

	-- Resolve in-flight projectiles. Two kinds:
	--  - the ordinary shot: a straight line from->to, damage lands the
	--    instant it arrives (unchanged from before).
	--  - a piercing shot: keeps travelling in a straight line after hitting
	--    its first target, and damages each further enemy its path actually
	--    crosses, until it has hit `1 + pierce` of them or leaves the field.
	--    Pierce is a count of enemies gone through, not a splash radius.
	local still_flying = {}
	for _, pr in ipairs(s.projectiles) do
		if pr.piercing then
			pr.pos.x = pr.pos.x + pr.dir.x * pr.speed * dt
			pr.pos.y = pr.pos.y + pr.dir.y * pr.speed * dt
			local hit = nil
			for _, m in ipairs(s.mobs) do
				if m.hp > 0 and not pr.hit_ids[m.id] and combat.dist(pr.pos, m.pos) <= m.radius then
					hit = m
					break
				end
			end
			local spent = false
			if hit then
				friendly_splash(s, hit.pos, pr.damage, pr.skill, now, pr.hit_ids)
				if pr.pierce_left <= 0 then
					spent = true
				else
					pr.pierce_left = pr.pierce_left - 1
				end
			end
			local off_field = pr.pos.x < -60 or pr.pos.x > SCREEN_W + 60 or pr.pos.y < -60 or pr.pos.y > PLAY_H + 60
			if not spent and not off_field then
				still_flying[#still_flying + 1] = pr
			end
		elseif now - pr.created_at >= pr.duration then
			local resolved = false
			if pr.friendly and pr.target_kind == "mob" and pr.skill == "burn" then
				resolved = true
				local target
				for _, m in ipairs(s.mobs) do
					if m.id == pr.target_id then target = m break end
				end
				local pos = target and target.hp > 0 and { x = target.pos.x, y = target.pos.y } or pr.to
				local burn_radius = skills.BURN_EXPLODE_RADIUS * (1 + bonus.splash)
				s.explosions[#s.explosions + 1] = {
					id = next_id("explosion"), pos = { x = pos.x, y = pos.y },
					radius = burn_radius, created_at = now,
				}
				for _, m in ipairs(s.mobs) do
					if m.hp > 0 and combat.dist(m.pos, pos) <= burn_radius then
						m.hp = m.hp - pr.explode_damage
						m.last_hit_skill = "burn"
						s.hit_flashes[#s.hit_flashes + 1] = { id = next_id("flash"), pos = { x = m.pos.x, y = m.pos.y }, created_at = now }
						s.floating_texts[#s.floating_texts + 1] = combat.make_floating_text(("-%d"):format(math.floor(pr.explode_damage + 0.5)), m.pos, combat.DAMAGE_TEXT_COLOR, now)
					end
				end
			elseif pr.friendly and pr.target_kind == "mob" and pr.skill == "swordthrow" then
				resolved = true
				local target
				for _, m in ipairs(s.mobs) do
					if m.id == pr.target_id then target = m break end
				end
				if target and target.hp > 0 then
					local pos = { x = target.pos.x, y = target.pos.y }
					friendly_splash(s, pos, pr.damage, pr.skill, now)
					if target.hp <= 0 then
						-- Bounces to the next living target it can reach, in the
						-- same throw, rather than being thrown again.
						local next_target, best = nil, math.huge
						for _, m in ipairs(s.mobs) do
							if m.hp > 0 and not pr.bounce_hit_ids[m.id] then
								local d = combat.dist(pos, m.pos)
								if d <= skills.SWORD_THROW_RANGE + m.radius and d < best then
									next_target, best = m, d
								end
							end
						end
						if next_target then
							pr.bounce_hit_ids[next_target.id] = true
							pr.from = pos
							pr.to = { x = next_target.pos.x, y = next_target.pos.y }
							pr.target_id = next_target.id
							pr.created_at = now
							pr.duration = math.max(0.08, best / combat.PROJECTILE_SPEED)
							still_flying[#still_flying + 1] = pr
						end
					end
				end
			elseif pr.friendly and pr.target_kind == "mob" then
				resolved = true
				local target
				for _, m in ipairs(s.mobs) do
					if m.id == pr.target_id then target = m break end
				end
				if target and target.hp > 0 then
					friendly_splash(s, { x = target.pos.x, y = target.pos.y }, pr.damage, pr.skill, now)
				end
			end
			if resolved then
				-- handled above
			elseif not pr.friendly and pr.target_kind == "player" then
				damage_to_player = damage_to_player + pr.damage
				s.floating_texts[#s.floating_texts + 1] = combat.make_floating_text(("-%d"):format(math.floor(pr.damage + 0.5)), pr.to, combat.TAKEN_TEXT_COLOR, now)
				s.hit_flashes[#s.hit_flashes + 1] = { id = next_id("flash"), pos = { x = pr.to.x, y = pr.to.y }, created_at = now }
			elseif not pr.friendly and pr.target_kind == "ally" then
				for _, a in ipairs(s.allies) do
					if a.id == pr.target_id then a.hp = a.hp - pr.damage break end
				end
				s.floating_texts[#s.floating_texts + 1] = combat.make_floating_text(("-%d"):format(math.floor(pr.damage + 0.5)), pr.to, combat.TAKEN_TEXT_COLOR, now)
				s.hit_flashes[#s.hit_flashes + 1] = { id = next_id("flash"), pos = { x = pr.to.x, y = pr.to.y }, created_at = now }
			elseif not pr.friendly and pr.target_kind == "girl" then
				damage_to_girl = damage_to_girl + pr.damage
				s.floating_texts[#s.floating_texts + 1] = combat.make_floating_text(("-%d"):format(math.floor(pr.damage + 0.5)), pr.to, combat.TAKEN_TEXT_COLOR, now)
				s.hit_flashes[#s.hit_flashes + 1] = { id = next_id("flash"), pos = { x = pr.to.x, y = pr.to.y }, created_at = now }
			end
		else
			still_flying[#still_flying + 1] = pr
		end
	end

	-- Player movement toward target. A falling knight takes no orders.
	local moving = false
	if p.target and s.die_timer == nil then
		local d = combat.dist(p.pos, p.target)
		if d < 4 then
			p.pos = { x = p.target.x, y = p.target.y }
			p.target = nil
		else
			local dx = p.target.x - p.pos.x
			local dy = p.target.y - p.pos.y
			local speed = p.intro_phase == "enter" and combat.INTRO_WALK_SPEED
				or (combat.PLAYER_SPEED + s.gear_bonus.move_speed)
			local ratio = math.min(1, speed * dt / d)
			p.pos = { x = p.pos.x + dx * ratio, y = p.pos.y + dy * ratio }
			p.facing = combat.facing_from_delta(dx, dy)
			moving = true
		end
	end

	p.anim_time = p.anim_time + dt

	-- Not while running in: he starts beyond the top edge on purpose.
	if p.intro_phase ~= "enter" then
		p.pos.x = math.max(combat.PLAYER_RADIUS, math.min(SCREEN_W - combat.PLAYER_RIGHT_BUFFER - combat.PLAYER_RADIUS, p.pos.x))
		p.pos.y = math.max(combat.PLAYER_RADIUS + combat.PLAYER_TOP_BUFFER,
			math.min(PLAY_H - combat.PLAYER_RADIUS, p.pos.y))
		p.pos = keep_outside(p.pos, s.girl.pos,
			combat.PLAYER_RADIUS + s.girl.radius, 0, -1)
	end

	if s.die_timer == nil and p.hp > 0 then
		-- Clamp legacy saves that may still contain health from Berserker's
		-- removed passive bonus; equipping it no longer heals or raises the cap.
		p.hp = math.min(p.max_hp, p.hp + (combat.PLAYER_HEALTH_REGEN + s.gear_bonus.health_regen) * dt)
	end
	p.attack_cooldown = math.max(0, p.attack_cooldown - dt)
	p.haste_timer = math.max(0, p.haste_timer - dt)

	-- Drain Life: channels while planted, breaks the instant he moves.
	if s.drain_channel then
		if moving then
			s.drain_channel = nil
			s.drain_links = {}
		else
			local dc = s.drain_channel
			dc.time_left = dc.time_left - dt
			local dps = skills.drain_life_dps(dc.level) * ability_power(s)
			local links = {}
			local healed = 0
			for _, m in ipairs(s.mobs) do
				if m.hp > 0 and combat.dist(p.pos, m.pos) <= skills.DRAIN_LIFE_RADIUS then
					local amount = dps * dt
					m.hp = m.hp - amount
					m.last_hit_skill = "drainlife"
					healed = healed + amount
					links[#links + 1] = { id = m.id, from = { x = p.pos.x, y = p.pos.y }, to = { x = m.pos.x, y = m.pos.y } }
				end
			end
			if healed > 0 then p.hp = math.min(p.max_hp, p.hp + healed) end
			s.drain_links = links
			if dc.time_left <= 0 then
				s.drain_channel = nil
				s.drain_links = {}
			end
		end
	end

	-- The basic attack is a plain short-range swing; Berserker changes it only
	-- for the duration of its activated buff.
	local pierce_extra = 0
	local is_ranged_attack = false
	local ally_regen = 0
	local player_attack_range = combat.PLAYER_ATTACK_RANGE
	local run_bonus = upgrades.bonuses(s.upgrades)
	local player_damage = combat.PLAYER_BASE_DAMAGE + run_bonus.attack_damage + s.gear_bonus.attack_damage
	-- +50% attack speed is 1.5x attacks per second, or two-thirds cooldown.
	local attack_cooldown_duration = combat.PLAYER_ATTACK_COOLDOWN
		/ (1 + run_bonus.attack_speed + s.gear_bonus.attack_speed) * (p.haste_timer > 0 and (1 / 1.5) or 1)
	local attack_anim_speed = math.max(1, combat.anim_duration(combat.ANIMS.attack) / attack_cooldown_duration)
	-- A plain auto-attack answers to no skill for kill xp now.
	local player_atk_skill = nil

	-- Mob AI.
	for _, m in ipairs(s.mobs) do
		m.attack_cooldown = math.max(0, m.attack_cooldown - dt)
		m.anim_time = m.anim_time + dt
		m.flash_time = math.max(0, m.flash_time - dt)
		m.hurt_gap = math.max(0, m.hurt_gap - dt)
		m.stun_timer = math.max(0, (m.stun_timer or 0) - dt)

		-- The shove from the last blow, bleeding off. Held inside the field.
		if m.knock.x ~= 0 or m.knock.y ~= 0 then
			local nx = math.min(SCREEN_W - m.radius, math.max(m.radius, m.pos.x + m.knock.x * dt))
			local ny = math.min(PLAY_H - m.radius, math.max(m.radius, m.pos.y + m.knock.y * dt))
			if m.knock_limit then
				local dx = nx - m.knock_limit.x
				local dy = ny - m.knock_limit.y
				local d = math.sqrt(dx * dx + dy * dy)
				if d >= m.knock_limit.range then
					local scale = d > 0 and m.knock_limit.range / d or 0
					nx = m.knock_limit.x + dx * scale
					ny = m.knock_limit.y + dy * scale
					m.knock = { x = 0, y = 0 }
					m.knock_limit = nil
				end
			end
			m.pos = { x = nx, y = ny }
			local fade = math.exp(-dt / combat.KNOCKBACK_TAU)
			m.knock = { x = m.knock.x * fade, y = m.knock.y * fade }
			if math.sqrt(m.knock.x ^ 2 + m.knock.y ^ 2) < combat.KNOCKBACK_STOP then
				m.knock = { x = 0, y = 0 }
				m.knock_limit = nil
			end
		end

		if m.stun_timer <= 0 then
		local mob_busy = (not combat.MOB_ANIMS[m.anim].loop) and m.anim_time < combat.anim_duration(combat.MOB_ANIMS[m.anim])
		local function set_mob_anim(next_anim)
			if mob_busy then return end
			if next_anim ~= m.anim or not combat.MOB_ANIMS[next_anim].loop then m.anim_time = 0 end
			m.anim = next_anim
		end
		local mob_base = combat.base_mob_type(m.type)
		local inside_gameplay = m.pos.x >= m.radius
			and m.pos.x <= SCREEN_W - m.radius
			and m.pos.y >= m.radius and m.pos.y <= PLAY_H - m.radius
		local detect = mob_base == "boss" and 99999
			or (mob_base == "ranged" and 260 or combat.RANGED_ATTACK_RANGE)

		local nearest, nearest_dist = nil, math.huge
		local d_to_player = combat.dist(m.pos, p.pos)
		if p.hp > 0 and d_to_player <= detect then
			nearest = { kind = "player", pos = p.pos }
			nearest_dist = d_to_player
		end
		for _, a in ipairs(s.allies) do
			-- Flying summons are invisible to melee enemies and can only be
			-- targeted by ranged mobs.
			if a.hp > 0 and (not a.flying or mob_base == "ranged") then
				local d_to_ally = combat.dist(m.pos, a.pos)
				if d_to_ally <= detect and d_to_ally < nearest_dist then
					nearest = { kind = "ally", id = a.id, pos = a.pos }
					nearest_dist = d_to_ally
				end
			end
		end
		-- The girl is the fallback objective. Nearby living defenders always
		-- take priority; with none detected, enemies cross the arena for her.
		if not nearest and s.girl.hp > 0 then
			if mob_base ~= "ranged" or math.abs(m.pos.x - s.girl.pos.x) <= detect then
				nearest = { kind = "girl", pos = s.girl.pos }
				nearest_dist = combat.dist(m.pos, s.girl.pos)
			end
		end

		if not nearest then
			if mob_base == "ranged" then
				local direction = m.spawn_side == "left" and 1 or -1
				if direction > 0 then
					m.pos.x = math.min(SCREEN_W - m.radius, m.pos.x + combat.MOB_SPEED * dt)
				else
					m.pos.x = math.max(m.radius, m.pos.x - combat.MOB_SPEED * dt)
				end
				m.facing = direction > 0 and 0 or 4
			else
				set_mob_anim("idle")
			end
		else
			m.facing = combat.facing_from_delta(nearest.pos.x - m.pos.x, nearest.pos.y - m.pos.y)

			if mob_base == "ranged" then
				if inside_gameplay and nearest_dist <= combat.MOB_RANGED_FIRE_RANGE then
					if m.attack_cooldown <= 0 then
						s.projectiles_new = s.projectiles_new or {}
						still_flying[#still_flying + 1] = {
							id = next_id("projectile"),
							from = { x = m.pos.x, y = m.pos.y },
							to = { x = nearest.pos.x, y = nearest.pos.y },
							created_at = now,
							duration = math.max(0.08, nearest_dist / combat.PROJECTILE_SPEED),
							color = { 1, 0.541, 0.502 },
							damage = m.damage,
							friendly = false,
							target_kind = nearest.kind,
							target_id = nearest.id or -1,
						}
						m.attack_cooldown = combat.MOB_ATTACK_COOLDOWN
					end
				else
					local dx = nearest.pos.x - m.pos.x
					local dy = nearest.pos.y - m.pos.y
					local ratio = math.min(1, combat.MOB_SPEED * dt / nearest_dist)
					m.pos = { x = m.pos.x + dx * ratio, y = m.pos.y + dy * ratio }
				end
			else
				local contact = combat.MOB_ATTACK_RANGE + (m.radius - combat.MOB_RADIUS)
				if inside_gameplay and nearest_dist <= contact then
					if m.attack_cooldown <= 0 then
						if nearest.kind == "player" then
							damage_to_player = damage_to_player + m.damage
							s.hit_flashes[#s.hit_flashes + 1] = { id = next_id("flash"), pos = { x = p.pos.x, y = p.pos.y }, created_at = now }
							s.floating_texts[#s.floating_texts + 1] = combat.make_floating_text(("-%d"):format(m.damage), p.pos, combat.TAKEN_TEXT_COLOR, now)
						elseif nearest.kind == "ally" then
							for _, a in ipairs(s.allies) do
								if a.id == nearest.id then
									a.hp = a.hp - m.damage
									s.hit_flashes[#s.hit_flashes + 1] = { id = next_id("flash"), pos = { x = a.pos.x, y = a.pos.y }, created_at = now }
									s.floating_texts[#s.floating_texts + 1] = combat.make_floating_text(("-%d"):format(m.damage), a.pos, combat.TAKEN_TEXT_COLOR, now)
									break
								end
							end
						else
							damage_to_girl = damage_to_girl + m.damage
							s.hit_flashes[#s.hit_flashes + 1] = { id = next_id("flash"), pos = { x = s.girl.pos.x, y = s.girl.pos.y }, created_at = now }
							s.floating_texts[#s.floating_texts + 1] = combat.make_floating_text(("-%d"):format(m.damage), s.girl.pos, combat.TAKEN_TEXT_COLOR, now)
						end
						m.attack_cooldown = combat.MOB_ATTACK_COOLDOWN
						set_mob_anim(combat.MOB_ATTACK_ANIMS[math.random(#combat.MOB_ATTACK_ANIMS)])
					end
				else
					local dx = nearest.pos.x - m.pos.x
					local dy = nearest.pos.y - m.pos.y
					local ratio = math.min(1, combat.MOB_SPEED * dt / nearest_dist)
					m.pos = { x = m.pos.x + dx * ratio, y = m.pos.y + dy * ratio }
					set_mob_anim("walk")
				end
			end
		end
		end
	end
	for _, m in ipairs(s.mobs) do
		m.pos = keep_outside(m.pos, s.girl.pos, m.radius + s.girl.radius,
			m.pos.x < s.girl.pos.x and -1 or 1, 0)
	end

	-- Whether a swing fired this frame will actually be seen (the flinch has
	-- right of way in the animation chain below).
	local pre_def = combat.ANIMS[p.anim]
	local pre_busy = (not pre_def.loop)
		and p.anim_time * p.anim_speed < combat.anim_duration(pre_def)
		and not (pre_def.interrupted_by_moving and moving)
	local flinch_will_win = damage_to_player > 0
		and not (p.anim == "attack" and pre_busy)
		and s.hurt_anim_gap - dt <= 0
	local swing_hidden = flinch_will_win or (pre_busy and p.anim ~= "attack")

	-- Player attack.
	local player_attacked = false
	local attack_targets = {}
	local any_mob_died_this_swing = false
	if p.attack_cooldown <= 0 and s.die_timer == nil and not s.drain_channel then
		if is_ranged_attack then
			local target, best = nil, math.huge
			for _, m in ipairs(s.mobs) do
				if m.hp > 0 then
					local d = combat.dist(m.pos, p.pos)
					if d <= player_attack_range and d < best then
						best = d
						target = m
					end
				end
			end
			if target then
				attack_targets[#attack_targets + 1] = { x = target.pos.x, y = target.pos.y }
				if pierce_extra > 0 then
					-- A piercing shot travels on in a straight line rather
					-- than resolving at a fixed point: it keeps going after
					-- the first hit and damages whatever else its path
					-- actually crosses, up to pierce_extra further enemies.
					local dx = target.pos.x - p.pos.x
					local dy = target.pos.y - p.pos.y
					local len = math.sqrt(dx * dx + dy * dy)
					if len == 0 then len = 1 end
					still_flying[#still_flying + 1] = {
						id = next_id("projectile"),
						piercing = true,
						from = { x = p.pos.x, y = p.pos.y },
						pos = { x = p.pos.x, y = p.pos.y },
						dir = { x = dx / len, y = dy / len },
						speed = combat.PROJECTILE_SPEED,
						color = { 0.882, 0.961, 0.996 },
						damage = player_damage,
						pierce_left = pierce_extra,
						hit_ids = {},
						skill = player_atk_skill,
					}
				else
					still_flying[#still_flying + 1] = {
						id = next_id("projectile"),
						from = { x = p.pos.x, y = p.pos.y },
						to = { x = target.pos.x, y = target.pos.y },
						created_at = now,
						duration = math.max(0.08, combat.dist(p.pos, target.pos) / combat.PROJECTILE_SPEED),
						color = { 0.882, 0.961, 0.996 },
						damage = player_damage,
						friendly = true,
						target_kind = "mob",
						target_id = target.id,
						skill = player_atk_skill,
					}
				end
				p.attack_cooldown = attack_cooldown_duration
				player_attacked = true
			end
		else
			local hit_any = false
			for _, m in ipairs(s.mobs) do
				if m.hp > 0 and combat.dist(m.pos, p.pos) <= player_attack_range + (m.radius - combat.MOB_RADIUS) then
					m.hp = m.hp - player_damage
					m.last_hit_skill = player_atk_skill
					combat.hurt_mob(m, swing_hidden and nil or p.pos,
						player_attack_range + (m.radius - combat.MOB_RADIUS))
					apply_lifesteal(s, player_damage)
					hit_any = true
					attack_targets[#attack_targets + 1] = { x = m.pos.x, y = m.pos.y }
					s.hit_flashes[#s.hit_flashes + 1] = { id = next_id("flash"), pos = { x = m.pos.x, y = m.pos.y }, created_at = now }
					s.floating_texts[#s.floating_texts + 1] = combat.make_floating_text(("-%d"):format(math.floor(player_damage + 0.5)), m.pos, combat.DAMAGE_TEXT_COLOR, now)
				end
			end
			if hit_any then
				p.attack_cooldown = attack_cooldown_duration
				player_attacked = true
			end
		end
	end

	-- Ally AI.
	for _, a in ipairs(s.allies) do
		if a.hp > 0 then
			if ally_regen > 0 and a.hp < a.max_hp then
				a.hp = math.min(a.max_hp, a.hp + ally_regen * dt)
			end
			-- Fire Enrage: faster swings and bonus fire damage on each attack;
			-- it also keeps a borrowed-time summon (Dead Again/The Cure/
			-- Monster Zombie) from expiring while it's up.
			local enraged = (a.enrage_timer or 0) > 0
			if enraged then
				a.enrage_timer = a.enrage_timer - dt
			end
			if a.expire_timer and not enraged then
				a.expire_timer = a.expire_timer - dt
				if a.expire_timer <= 0 then a.hp = 0 end
			end
			local attack_damage = a.damage + (enraged and (a.enrage_damage or 0) or 0)
			local attack_skill = enraged and "fireball" or (a.source_skill or "summon")
			a.attack_cooldown = math.max(0, a.attack_cooldown - dt)
			local engage_range = a.ranged and combat.ALLY_RANGED_ENGAGE_RANGE or combat.ALLY_ENGAGE_RANGE
			local atk_range = a.ranged and combat.ALLY_RANGED_ATTACK_RANGE or combat.ALLY_ATTACK_RANGE
			local mob_targets = {}
			for _, m in ipairs(s.mobs) do
				if m.hp > 0 then mob_targets[#mob_targets + 1] = { kind = "mob", id = m.id, pos = m.pos } end
			end
			local nearest = skills.nearest_target(a.pos, mob_targets, engage_range)
			if nearest then
				local d = combat.dist(a.pos, nearest.pos)
				if d <= atk_range then
					if a.attack_cooldown <= 0 then
						local mob
						for _, m in ipairs(s.mobs) do
							if m.id == nearest.id then mob = m break end
						end
						if mob then
							if a.ranged then
								still_flying[#still_flying + 1] = {
									id = next_id("projectile"),
									from = { x = a.pos.x, y = a.pos.y },
									to = { x = mob.pos.x, y = mob.pos.y },
									created_at = now,
									duration = math.max(0.08, combat.dist(a.pos, mob.pos) / combat.PROJECTILE_SPEED),
									color = { 0.82, 0.769, 0.914 },
									damage = attack_damage,
									friendly = true,
									target_kind = "mob",
									target_id = mob.id,
									skill = attack_skill,
								}
							else
								friendly_splash(s, mob.pos, attack_damage, attack_skill, now)
							end
						end
						a.attack_cooldown = combat.ally_attack_cooldown(a.level)
							/ (enraged and (1 + skills.FIREBALL_ENRAGE_ATKSPD) or 1)
					end
				else
					local dx = nearest.pos.x - a.pos.x
					local dy = nearest.pos.y - a.pos.y
					local ratio = math.min(1, combat.ALLY_SPEED * dt / d)
					a.pos = {
							x = math.max(combat.ALLY_RADIUS,
								math.min(SCREEN_W - combat.PLAYER_RIGHT_BUFFER - combat.ALLY_RADIUS, a.pos.x + dx * ratio)),
						y = math.max(combat.ALLY_RADIUS + combat.PLAYER_TOP_BUFFER,
							math.min(PLAY_H - combat.ALLY_RADIUS, a.pos.y + dy * ratio)),
					}
				end
			elseif a.home_pos then
				local d = combat.dist(a.pos, a.home_pos)
				if d > 2 then
					local dx = a.home_pos.x - a.pos.x
					local dy = a.home_pos.y - a.pos.y
					local ratio = math.min(1, combat.ALLY_SPEED * dt / d)
					a.pos = {
						x = math.max(combat.ALLY_RADIUS,
							math.min(SCREEN_W - combat.PLAYER_RIGHT_BUFFER - combat.ALLY_RADIUS, a.pos.x + dx * ratio)),
						y = math.max(combat.ALLY_RADIUS + combat.PLAYER_TOP_BUFFER,
							math.min(PLAY_H - combat.ALLY_RADIUS, a.pos.y + dy * ratio)),
					}
				else
					a.pos = { x = a.home_pos.x, y = a.home_pos.y }
				end
			end
		end
	end

	M.resolve_body_collisions(s)

	-- The wave delivers the cone's blows as it reaches each enemy.
	if #s.cone_hits > 0 then
		local still_carried = {}
		for _, h in ipairs(s.cone_hits) do
			if h.at > now then
				still_carried[#still_carried + 1] = h
			else
				local m
				for _, x in ipairs(s.mobs) do
					if x.id == h.mob_id then m = x break end
				end
				if m and m.hp > 0 then
					m.hp = m.hp - h.amount
					m.last_hit_skill = "cone"
					combat.hurt_mob(m) -- no from-point: the cone never shoved anyone
					apply_lifesteal(s, h.amount)
					s.floating_texts[#s.floating_texts + 1] = combat.make_floating_text(("-%d"):format(math.floor(h.amount + 0.5)), m.pos, combat.DAMAGE_TEXT_COLOR, now)
					s.hit_flashes[#s.hit_flashes + 1] = { id = next_id("flash"), pos = { x = m.pos.x, y = m.pos.y }, created_at = now }
				end
			end
		end
		s.cone_hits = still_carried
	end

	-- Deaths: corpses, blood, XP, coins.
	local survivor_mobs = {}
	local any_mob_died = false
	local last_death_pos = nil
	for _, m in ipairs(s.mobs) do
		if m.hp > 0 then
			survivor_mobs[#survivor_mobs + 1] = m
		else
			any_mob_died = true
			last_death_pos = { x = m.pos.x, y = m.pos.y }
			if combat.base_mob_type(m.type) == "melee" then
				s.corpses[#s.corpses + 1] = {
					id = next_id("corpse"), pos = { x = m.pos.x, y = m.pos.y }, facing = m.facing,
					anim = math.random() < 0.5 and "die" or "die2", age = 0,
				}
				-- Dead Again's resummon pool: tracked but invisible.
				s.zombie_corpses[#s.zombie_corpses + 1] = {
					id = next_id("zcorpse"), pos = { x = m.pos.x, y = m.pos.y }, age = 0,
				}
			end
			s.blood[#s.blood + 1] = {
				id = next_id("blood"), pos = { x = m.pos.x, y = m.pos.y },
				variant = math.random(0, combat.BLOOD_VARIANTS - 1), created_at = now,
			}
			-- The skill attached to the killing blow earns this kill's practice
			-- toward its next rank, if it is equipped and not already maxed.
			if m.last_hit_skill then
				grant_skill_kill_xp(s, m.last_hit_skill, m.pos)
			end
			local coins = combat.base_mob_type(m.type) == "boss" and combat.BOSS_COINS or (math.random() < combat.MOB_COIN_CHANCE and 1 or 0)
			if coins > 0 then
				-- Greeder upgrade: more gold this whole run.
				coins = math.floor(coins * (1 + bonus.gold) + 0.5)
				emit(s, { type = "coins", count = coins })
			end
		end
	end
	s.mobs = survivor_mobs
	local survivor_allies = {}
	for _, a in ipairs(s.allies) do
		if a.hp > 0 then survivor_allies[#survivor_allies + 1] = a end
	end
	s.allies = survivor_allies

	if damage_to_player > 0 then p.hp = math.max(0, p.hp - damage_to_player) end
	if damage_to_girl > 0 then s.girl.hp = math.max(0, s.girl.hp - damage_to_girl) end

	-- The fall: hp reaching zero starts the die timer; the field keeps
	-- simulating while he goes down. Revived mid-fall stands back up.
	if s.die_timer == nil then
		if p.hp <= 0 then
			s.die_timer = combat.anim_duration(combat.ANIMS.die) + combat.DIE_HOLD
			p.target = nil
			s.pending_cast_anim = nil
			s.swing_sound_timer = 0
			s.swing_gore_pos = nil
			emit(s, { type = "sfx", name = "hurt", variants = 1 })
		end
	elseif p.hp > 0 then
		s.die_timer = nil
		p.anim = "idle"
		p.anim_time = 0
		p.anim_speed = 1
	else
		s.die_timer = s.die_timer - dt
	end

	-- Turn to face what he is hitting, but only from a standstill.
	if player_attacked and not moving then
		p.facing = combat.facing_for_targets(p.pos, attack_targets, p.facing)
	end

	-- The entrance, one step at a time.
	local start_draw = false
	if p.intro_phase == "enter" then
		if not p.target then
			p.intro_phase = "settle"
			p.intro_timer = combat.INTRO_SETTLE
		end
	elseif p.intro_phase == "settle" then
		p.intro_timer = p.intro_timer - dt
		if p.intro_timer <= 0 then
			p.intro_phase = "draw"
			start_draw = true
		end
	elseif p.intro_phase == "draw" and p.anim ~= "spawn" then
		p.intro_phase = "done"
	end

	local current = combat.ANIMS[p.anim]
	local one_shot_busy = (not current.loop)
		and p.anim_time * p.anim_speed < combat.anim_duration(current)
		and not (current.interrupted_by_moving and moving)

	s.hurt_anim_gap = math.max(0, s.hurt_anim_gap - dt)
	local mid_swing = p.anim == "attack" and one_shot_busy
	local may_flinch = damage_to_player > 0 and not mid_swing and s.hurt_anim_gap <= 0

	-- Standing between arriving and drawing: hold the walk's last frame.
	if p.intro_phase == "settle" then
		p.anim = "walk"
		p.anim_speed = 1
		p.anim_time = combat.INTRO_HOLD_FRAME / combat.ANIMS.walk.fps
	end

	-- A cast made on the run keeps its effect but skips its pose.
	if s.pending_cast_anim and moving then s.pending_cast_anim = nil end

	local next_anim = p.anim
	local restart_anim = false
	if s.die_timer ~= nil then
		next_anim = "die"
		restart_anim = p.anim ~= "die"
	elseif p.intro_phase == "settle" then
		-- nothing else gets a say while he waits
	elseif start_draw then
		next_anim = "spawn"
		restart_anim = true
		emit(s, { type = "sfx", name = "draw" })
	elseif may_flinch then
		next_anim = "hurt"
		restart_anim = true
		s.hurt_anim_gap = combat.HURT_ANIM_MIN_GAP
		emit(s, { type = "sfx", name = "hurt", variants = 1 })
	elseif s.pending_cast_anim and not one_shot_busy then
		next_anim = s.pending_cast_anim
		s.pending_cast_anim = nil
		restart_anim = true
	elseif not one_shot_busy and p.anim == "hurt" and not moving
		and math.random() < combat.KICK_CHANCE
		and (function()
			for _, m in ipairs(s.mobs) do
				if m.hp > 0 then
					local dx = m.pos.x - p.pos.x
					local dy = m.pos.y - p.pos.y
					local len = math.sqrt(dx * dx + dy * dy)
					if len <= combat.KICK_RANGE + (m.radius - combat.MOB_RADIUS) then
						if len <= 0.001 then return true end
						local dir = combat.facing_vector(p.facing)
						if (dx / len) * dir.x + (dy / len) * dir.y >= combat.KICK_ARC_COS then return true end
					end
				end
			end
			return false
		end)() then
		next_anim = "kick"
		restart_anim = true
		s.kick_shove_timer = combat.KICK_CONTACT_FRAME / combat.ANIMS.kick.fps
		local boot = math.random(#M.CLIP_LEAD.kick)
		s.kick_sound_name = "kick-" .. boot
		s.kick_sound_timer = math.max(0, combat.KICK_CONTACT_FRAME / combat.ANIMS.kick.fps - M.CLIP_LEAD.kick[boot])
	elseif not one_shot_busy then
		local travelling = p.intro_phase == "enter" and "walk" or "run"
		next_anim = player_attacked and "attack" or (moving and travelling or "idle")
		restart_anim = next_anim ~= p.anim or not combat.ANIMS[next_anim].loop
	end

	if restart_anim then
		p.anim_time = 0
		if next_anim == "attack" then
			p.anim_speed = attack_anim_speed
		elseif p.intro_phase == "enter" and next_anim == "walk" then
			p.anim_speed = combat.INTRO_WALK_ANIM
		else
			p.anim_speed = 1
		end

		-- The sword is heard only when it is seen.
		if next_anim == "attack" then
			s.swing_gore_pos = nil
			local lead
			if any_mob_died and math.random() < combat.KILL_SFX_CHANCE then
				local pool = #M.CLIP_LEAD.kill + #M.CLIP_LEAD.gore
				local pick = math.random(pool)
				if pick > #M.CLIP_LEAD.kill then
					local i = pick - #M.CLIP_LEAD.kill
					s.swing_sound_name = "gore-" .. i
					lead = M.CLIP_LEAD.gore[i]
					s.swing_gore_pos = last_death_pos
				else
					s.swing_sound_name = "kill-" .. pick
					lead = M.CLIP_LEAD.kill[pick]
				end
			else
				local i = math.random(#M.CLIP_LEAD.attack)
				s.swing_sound_name = "attack-" .. i
				lead = M.CLIP_LEAD.attack[i]
			end
			s.swing_sound_timer = math.max(0, combat.SWING_STRIKE_AT / attack_anim_speed - lead)
		else
			s.swing_sound_timer = 0
			s.swing_gore_pos = nil
		end
	end
	p.anim = next_anim

	-- Boots: read off where the animation has got to.
	if moving and (p.anim == "walk" or p.anim == "run") then
		local cycles = (p.anim_time * p.anim_speed * combat.ANIMS[p.anim].fps) / combat.SPRITE_COLS
		local step = math.floor((cycles - combat.FOOTSTEP_PHASE) * combat.STEPS_PER_CYCLE)
		if s.footstep_step == nil or step ~= s.footstep_step then
			s.footstep_step = step
			emit(s, { type = "footstep", pos = { x = p.pos.x, y = p.pos.y } })
		end
	else
		s.footstep_step = nil
	end

	if s.swing_sound_timer > 0 then
		s.swing_sound_timer = s.swing_sound_timer - dt
		if s.swing_sound_timer <= 0 then
			emit(s, { type = "sfx", name = s.swing_sound_name })
			local gore_pos = s.swing_gore_pos
			if gore_pos then
				for _ = 1, combat.GORE_EXTRA_SPLATS do
					s.blood[#s.blood + 1] = {
						id = next_id("blood"),
						pos = {
							x = gore_pos.x + (math.random() - 0.5) * combat.GORE_SPLATTER_SPREAD * 2,
							y = gore_pos.y + (math.random() - 0.5) * combat.GORE_SPLATTER_SPREAD,
						},
						variant = math.random(0, combat.BLOOD_VARIANTS - 1),
						created_at = now,
					}
				end
				s.swing_gore_pos = nil
			end
		end
	end

	-- The boot's sound, on its own clock.
	if s.kick_sound_timer > 0 then
		s.kick_sound_timer = s.kick_sound_timer - dt
		if s.kick_sound_timer <= 0 and p.anim == "kick" then
			emit(s, { type = "sfx", name = s.kick_sound_name })
		end
	end

	-- The kick lands: everyone in the fan is shoved.
	if s.kick_shove_timer > 0 then
		s.kick_shove_timer = s.kick_shove_timer - dt
		if s.kick_shove_timer <= 0 and p.anim == "kick" then
			local dir = combat.facing_vector(p.facing)
			for _, m in ipairs(s.mobs) do
				if m.hp > 0 then
					local dx = m.pos.x - p.pos.x
					local dy = m.pos.y - p.pos.y
					local len = math.sqrt(dx * dx + dy * dy)
					if len <= combat.KICK_RANGE + (m.radius - combat.MOB_RADIUS) then
						if len <= 0.001 or (dx / len) * dir.x + (dy / len) * dir.y >= combat.KICK_ARC_COS then
							combat.shove_mob(m, p.pos,
								combat.PLAYER_ATTACK_RANGE + (m.radius - combat.MOB_RADIUS))
						end
					end
				end
			end
		end
	end

	-- Wave spawning: every wave still spawning keeps its own timer.
	if s.wave_active and #s.wave_queues > 0 then
		local still_spawning = {}
		for _, entry in ipairs(s.wave_queues) do
			entry.timer = entry.timer + dt
			while #entry.types > 0 and entry.timer >= entry.interval do
				entry.timer = entry.timer - entry.interval
				local mob_type = table.remove(entry.types, 1)
				if mob_type then
					local side = entry.spawned % 2 == 0 and "left" or "right"
					s.mobs[#s.mobs + 1] = combat.spawn_mob(mob_type, entry.wave, side)
					entry.spawned = entry.spawned + 1
				end
			end
			if #entry.types > 0 then still_spawning[#still_spawning + 1] = entry end
		end
		s.wave_queues = still_spawning
		if #s.wave_queues == 0 then s.wave_active = false end
	end

	-- Each owed wave clears on its own. Every fifth wave schedules an upgrade
	-- choice one second after its final enemy dies.
	-- offer is queued rather than picked for you -- the player
	-- answers it (M.choose_upgrade) whenever they get to it; movement waits
	-- on the oldest unanswered one (see tap_field).
	local wave_just_cleared = false
	if #s.loot_owed > 0 then
		local still_owed = {}
		for _, w in ipairs(s.loot_owed) do
			local done_spawning = true
			for _, e in ipairs(s.wave_queues) do
				if e.wave == w then done_spawning = false break end
			end
			local any_alive = false
			for _, m in ipairs(s.mobs) do
				if m.wave == w then any_alive = true break end
			end
			if done_spawning and not any_alive then
				wave_just_cleared = true
				s.highest_wave_cleared = math.max(s.highest_wave_cleared, w)
				if w == M.map_last_wave(s.map_index) then
					-- Only open the map if the drawing leads anywhere from
					-- here; past the last place the waves just keep coming.
					s.route_pending = M.route_has_next(s)
					-- The opening pays gold and gear only; the skill point
					-- waits for the heart, and so does the skill tree.
					emit(s, { type = "checkpoint_reward", wave = w,
						opening = M.is_opening_map(s.map_index) })
				end
				grant_wave_clear_xp(s)
			else
				still_owed[#still_owed + 1] = w
			end
		end
		s.loot_owed = still_owed
		if wave_just_cleared then s.wave_countdown = M.WAVE_COUNTDOWN end
	end

	-- Auto-advance immediately, including wave one during the entrance walk.
	-- Checkpoint rewards, route choices, death, and upgrade offers still hold.
	if s.wave_countdown ~= nil and not s.game_over and not s.wave_active and #s.mobs == 0
		and s.die_timer == nil
		and not s.route_pending and #s.pending_upgrade_offers == 0 and s.upgrade_offer_timer == nil then
		M.start_next_wave(s)
	end

	for k = 1, 3 do
		s.abilities[k].cooldown = math.max(0, s.abilities[k].cooldown - dt)
	end

	s.projectiles = still_flying

	-- Sweep up spent transients.
	local function sweep(list, keep)
		local out = {}
		for _, e in ipairs(list) do
			if keep(e) then out[#out + 1] = e end
		end
		return out
	end
	s.hit_flashes = sweep(s.hit_flashes, function(f) return now - f.created_at < combat.HIT_FLASH_DURATION end)
	s.blood = sweep(s.blood, function(b) return now - b.created_at < combat.BLOOD_DURATION end)
	for _, c in ipairs(s.corpses) do c.age = c.age + dt end
	s.corpses = sweep(s.corpses, function(c)
		return c.age < combat.anim_duration(combat.MOB_DIE_ANIMS[c.anim]) + combat.CORPSE_LINGER + combat.CORPSE_FADE
	end)
	for _, c in ipairs(s.zombie_corpses) do c.age = c.age + dt end
	s.zombie_corpses = sweep(s.zombie_corpses, function(c) return c.age < skills.ZOMBIE_CORPSE_LIFETIME end)
	local cone_zone_life = skills.CONE_RANGE / skills.CONE_ZONE.sweep_speed + skills.CONE_ZONE.cell_life + 0.08
	s.cone_zones = sweep(s.cone_zones, function(z) return now < z.start_at + cone_zone_life end)
	s.skill_marks = sweep(s.skill_marks, function(m) return now - m.created_at < combat.SKILL_MARK_DURATION end)
	s.lightning_links = sweep(s.lightning_links, function(l)
		return now - l.created_at < skills.CHAIN_LIGHTNING_VISUAL_DURATION
	end)
	s.explosions = sweep(s.explosions, function(e)
		return now - e.created_at < skills.BURN_EXPLOSION_VISUAL_DURATION
	end)
	s.floating_texts = sweep(s.floating_texts, function(f) return now - f.created_at < combat.FLOATING_TEXT_DURATION end)

	-- The game over waits for the fall.
	local is_game_over = s.girl.hp <= 0
		or (p.hp <= 0 and s.die_timer ~= nil and s.die_timer <= 0)
	if is_game_over then
		s.game_over_cause = s.girl.hp <= 0 and "girl" or "player"
		s.game_over = true
		emit(s, { type = "game_over", cause = s.game_over_cause })
	end
end

-- Resolve small feet circles after AI movement. This is simulation-only
-- separation rather than a combat hitbox: characters can still stand close
-- enough to use their existing melee ranges, but no longer stack visually.
function M.resolve_body_collisions(s)
	local bodies = {}
	local function in_field(pos)
		return pos.x >= 0 and pos.x <= SCREEN_W and pos.y >= 0 and pos.y <= PLAY_H
	end
	local function add(entity)
		if entity.hp > 0 and in_field(entity.pos) then
			bodies[#bodies + 1] = entity
		end
	end
	add(s.player)
	for _, mob in ipairs(s.mobs) do add(mob) end
	for _, ally in ipairs(s.allies) do
		-- A flying seagull has no feet on the field and passes overhead.
		if not ally.flying then add(ally) end
	end

	local min_distance = combat.FEET_COLLISION_RADIUS * 2
	-- A few cheap relaxation passes handle clustered spawns without the harsh
	-- teleporting produced by resolving the whole overlap in one direction.
	for _ = 1, 6 do
		for i = 1, #bodies - 1 do
			for j = i + 1, #bodies do
				local a, b = bodies[i], bodies[j]
				local dx, dy = b.pos.x - a.pos.x, b.pos.y - a.pos.y
				local d2 = dx * dx + dy * dy
				if d2 < min_distance * min_distance then
					local d = math.sqrt(d2)
					if d < 0.001 then
						dx, dy, d = ((i + j) % 2 == 0) and 1 or -1, 0, 1
					end
					local push = (min_distance - d) * 0.5
					local nx, ny = dx / d, dy / d
					a.pos.x = a.pos.x - nx * push
					a.pos.y = a.pos.y - ny * push
					b.pos.x = b.pos.x + nx * push
					b.pos.y = b.pos.y + ny * push
				end
			end
		end
	end

	for _, entity in ipairs(bodies) do
		local r = combat.FEET_COLLISION_RADIUS
		entity.pos.x = math.max(r,
			math.min(SCREEN_W - combat.PLAYER_RIGHT_BUFFER - r, entity.pos.x))
		entity.pos.y = math.max(r + combat.PLAYER_TOP_BUFFER,
			math.min(PLAY_H - r, entity.pos.y))
	end
end

return M
