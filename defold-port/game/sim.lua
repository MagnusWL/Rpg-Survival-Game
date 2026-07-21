-- The game simulation: App.tsx's step() loop and ability handlers, ported to
-- a pure-Lua module. It owns a state table, advances it with update(dt), and
-- reports side effects (sounds, saves, coins) as events for the view layer.
-- Time inside the sim is state.now, seconds of simulated time.
local layout = require("game.layout")
local combat = require("game.combat")
local items = require("game.items")
local skills = require("game.skills")

local M = {}

local SCREEN_W = layout.SCREEN_W
local PLAY_H = layout.PLAY_H

-- Measured clip lead times (assets/sounds/leads.json): how early each clip
-- must start so its loudest moment lands on the frame it belongs to.
M.CLIP_LEAD = {
	attack = { 0.0694, 0.0288, 0.0367 },
	kick = { 0.0972, 0.1754 },
	kill = { 0.062, 0.0443, 0.0356 },
	gore = { 0.1029, 0.1193, 0.129 },
}

local id_counters = { projectile = 0, flash = 0, mark = 0, blood = 0, corpse = 0, zone = 0 }
local function next_id(kind)
	id_counters[kind] = id_counters[kind] + 1
	return id_counters[kind]
end

function M.new(game_state, opts)
	opts = opts or {}
	local s = {
		now = 0,
		player = game_state.player,
		abilities = game_state.abilities,
		passive = game_state.passive,
		equipped = game_state.equipped,
		bag = game_state.bag,
		materials = game_state.materials,
		wave = game_state.wave,
		mobs = {},
		allies = {},
		projectiles = {},
		hit_flashes = {},
		skill_marks = {},
		blood = {},
		corpses = {},
		cone_zones = {},
		cone_hits = {},
		floating_texts = {},
		ground_items = {},
		wave_queues = {},
		loot_owed = {},
		wave_active = false,
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
		gold_banked = false,
		events = {},
	}
	return s
end

local function emit(s, ev)
	s.events[#s.events + 1] = ev
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

local function cd_scale(s)
	local pv = s.passive
	if pv and pv.skill == "cdreduce" then
		return 1 - skills.cooldown_reduce_percent(pv.level)
	end
	return 1
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
	local cost = skills.SKILL_META.cone.mana
	s.aiming_slot = nil
	s.aim_point = nil
	if s.die_timer ~= nil or ab.skill ~= "cone" or p.mana < cost then return end
	s.pending_cast_anim = "rupture"
	add_cone_zone(s, p.pos, math.atan2(point.y - p.pos.y, point.x - p.pos.x) * 180 / math.pi)
	local hits = skills.fire_cone(p.pos, point, s.mobs,
		skills.ability2_base_damage(ab.level), skills.ability2_damage_percent(ab.level),
		skills.CONE_RANGE, skills.ABILITY2_HALF_ANGLE_DEG)
	queue_cone_hits(s, hits, p.pos)
	p.mana = p.mana - cost
	ab.cooldown = skills.SKILL_META.cone.cooldown * cd_scale(s)
end

function M.press_ability(s, slot)
	if s.game_over or s.die_timer ~= nil then return end
	local ab = s.abilities[slot]
	local p = s.player
	local skill = ab.skill
	if not skill or ab.level <= 0 or ab.cooldown > 0 then return end
	if skills.SKILL_META[skill].cast == "passive" then return end
	local cost = skills.SKILL_META[skill].mana
	if p.mana < cost then return end

	if skill == "summon" then
		s.pending_cast_anim = "ancestor"
		s.allies = combat.make_allies_for_level(ab.level, p.pos, skills.ability1_stats)
	elseif skill == "cone" then
		s.pending_cast_anim = "rupture"
		local dir = combat.direction_from_facing(p.facing)
		local aim = { x = p.pos.x + dir.x * skills.CONE_RANGE, y = p.pos.y + dir.y * skills.CONE_RANGE }
		add_cone_zone(s, p.pos, math.atan2(dir.y, dir.x) * 180 / math.pi)
		local hits = skills.fire_cone(p.pos, aim, s.mobs,
			skills.ability2_base_damage(ab.level), skills.ability2_damage_percent(ab.level),
			skills.CONE_RANGE, skills.ABILITY2_HALF_ANGLE_DEG)
		queue_cone_hits(s, hits, p.pos)
	elseif skill == "ranged" then
		p.haste_timer = skills.ABILITY3_HASTE_DURATION
	elseif skill == "fireball" then
		local living = {}
		for _, a in ipairs(s.allies) do
			if a.hp > 0 then living[#living + 1] = a end
		end
		if #living == 0 then return end
		local pct = skills.fireball_damage_percent(ab.level)
		for _, a in ipairs(living) do
			s.skill_marks[#s.skill_marks + 1] = {
				id = next_id("mark"), pos = { x = a.pos.x, y = a.pos.y },
				radius = skills.FIREBALL_RADIUS, color = skills.SKILL_META.fireball.color, created_at = s.now,
			}
		end
		for _, m in ipairs(s.mobs) do
			local dmg = 0
			for _, a in ipairs(living) do
				if combat.dist(a.pos, m.pos) <= skills.FIREBALL_RADIUS then
					dmg = dmg + pct * a.damage
				end
			end
			if dmg > 0 then
				m.hp = m.hp - dmg
				s.hit_flashes[#s.hit_flashes + 1] = { id = next_id("flash"), pos = { x = m.pos.x, y = m.pos.y }, created_at = s.now }
				s.floating_texts[#s.floating_texts + 1] = combat.make_floating_text(("-%d"):format(math.floor(dmg + 0.5)), m.pos, combat.DAMAGE_TEXT_COLOR, s.now)
			end
		end
	elseif skill == "burn" then
		local candidates = {}
		for _, m in ipairs(s.mobs) do
			if m.hp > 0 then candidates[#candidates + 1] = { kind = "mob", id = m.id, pos = m.pos } end
		end
		local target = skills.nearest_target(p.pos, candidates, math.huge)
		if not target then return end
		for _, m in ipairs(s.mobs) do
			if m.id == target.id then
				m.burn_pct = skills.burn_explode_percent(ab.level)
				m.burn_dps = skills.burn_damage_per_sec(ab.level)
			end
		end
		s.floating_texts[#s.floating_texts + 1] = combat.make_floating_text("afire", target.pos, { 1, 0.439, 0.263 }, s.now)
		s.skill_marks[#s.skill_marks + 1] = {
			id = next_id("mark"), pos = { x = target.pos.x, y = target.pos.y },
			radius = 18, color = skills.SKILL_META.burn.color, created_at = s.now,
		}
	elseif skill == "push" then
		local dmg_bonus = items.equipped_bonus(s.equipped, "dmg")
		local ranged_lvl = equipped_level_of(s, "ranged")
		local atk_dmg = combat.PLAYER_BASE_DAMAGE + skills.ability3_damage_bonus(ranged_lvl) + dmg_bonus
		local dmg = skills.push_damage_percent(ab.level) * atk_dmg
		for _, m in ipairs(s.mobs) do
			local dx = m.pos.x - p.pos.x
			local dy = m.pos.y - p.pos.y
			local d = math.sqrt(dx * dx + dy * dy)
			if d == 0 then d = 1 end
			s.hit_flashes[#s.hit_flashes + 1] = { id = next_id("flash"), pos = { x = m.pos.x, y = m.pos.y }, created_at = s.now }
			s.floating_texts[#s.floating_texts + 1] = combat.make_floating_text(("-%d"):format(math.floor(dmg + 0.5)), m.pos, combat.DAMAGE_TEXT_COLOR, s.now)
			m.hp = m.hp - dmg
			m.knock = { x = dx / d * skills.PUSH_SPEED, y = dy / d * skills.PUSH_SPEED }
		end
		s.skill_marks[#s.skill_marks + 1] = {
			id = next_id("mark"), pos = { x = p.pos.x, y = p.pos.y },
			radius = 46, color = skills.SKILL_META.push.color, created_at = s.now,
		}
	end

	p.mana = p.mana - cost
	ab.cooldown = skills.SKILL_META[skill].cooldown * cd_scale(s)
end

function M.start_next_wave(s)
	if s.game_over then return end
	s.wave = s.wave + 1
	s.wave_queues[#s.wave_queues + 1] = { wave = s.wave, types = combat.build_wave_queue(s.wave), timer = 0 }
	s.wave_active = true
	s.loot_owed[#s.loot_owed + 1] = s.wave
end

-- Tap on the play field: order a move (or aim the cone).
function M.tap_field(s, x, y)
	if s.game_over or s.die_timer ~= nil then return end
	if s.aiming_slot then
		s.aim_point = { x = x, y = y }
		return
	end
	if s.player.intro_phase ~= "done" then return end
	s.player.target = { x = x, y = y }
end

-- One tick. Everything in App.tsx's step(), in the same order.
function M.update(s, dt)
	if s.game_over then return end
	s.now = s.now + dt
	local now = s.now
	local p = s.player

	local eq = s.equipped
	local dmg_bonus = items.equipped_bonus(eq, "dmg")
	local atkspd_bonus = items.equipped_bonus(eq, "atkspd")
	local mana_bonus = items.equipped_bonus(eq, "mana")
	local manaregen_bonus = items.equipped_bonus(eq, "manaregen")
	local hp_bonus = items.equipped_bonus(eq, "health")
	local hpregen_bonus = items.equipped_bonus(eq, "healthregen")
	local effective_max_mana = combat.MANA_MAX + mana_bonus

	local damage_to_player = 0

	-- Resolve in-flight projectiles: damage lands only on arrival.
	local still_flying = {}
	for _, pr in ipairs(s.projectiles) do
		if now - pr.created_at >= pr.duration then
			if pr.friendly and pr.target_kind == "mob" then
				local hit_positions = {}
				local target
				for _, m in ipairs(s.mobs) do
					if m.id == pr.target_id then target = m break end
				end
				if target and target.hp > 0 then
					target.hp = target.hp - pr.damage
					combat.hurt_mob(target, pr.from)
					hit_positions[#hit_positions + 1] = { x = target.pos.x, y = target.pos.y }
				end
				if (pr.pierce or 0) > 0 then
					local dx = pr.to.x - pr.from.x
					local dy = pr.to.y - pr.from.y
					local len = math.sqrt(dx * dx + dy * dy)
					if len == 0 then len = 1 end
					local ux, uy = dx / len, dy / len
					local extras = {}
					for _, m in ipairs(s.mobs) do
						if m.hp > 0 and m.id ~= pr.target_id then
							local rx = m.pos.x - pr.from.x
							local ry = m.pos.y - pr.from.y
							local along = rx * ux + ry * uy
							local perp = math.abs(rx * uy - ry * ux)
							if along > 0 and perp <= skills.PIERCE_WIDTH + m.radius then
								extras[#extras + 1] = { m = m, along = along }
							end
						end
					end
					table.sort(extras, function(a, b) return a.along < b.along end)
					for i = 1, math.min(pr.pierce, #extras) do
						local m = extras[i].m
						m.hp = m.hp - pr.damage
						combat.hurt_mob(m, pr.from)
						hit_positions[#hit_positions + 1] = { x = m.pos.x, y = m.pos.y }
					end
				end
				if #hit_positions == 0 then hit_positions[1] = { x = pr.to.x, y = pr.to.y } end
				for _, pos in ipairs(hit_positions) do
					s.floating_texts[#s.floating_texts + 1] = combat.make_floating_text(("-%d"):format(math.floor(pr.damage + 0.5)), pos, combat.DAMAGE_TEXT_COLOR, now)
					s.hit_flashes[#s.hit_flashes + 1] = { id = next_id("flash"), pos = pos, created_at = now }
				end
			elseif not pr.friendly and pr.target_kind == "player" then
				damage_to_player = damage_to_player + pr.damage
				s.floating_texts[#s.floating_texts + 1] = combat.make_floating_text(("-%d"):format(math.floor(pr.damage + 0.5)), pr.to, combat.TAKEN_TEXT_COLOR, now)
			elseif not pr.friendly and pr.target_kind == "ally" then
				for _, a in ipairs(s.allies) do
					if a.id == pr.target_id then a.hp = a.hp - pr.damage break end
				end
				s.floating_texts[#s.floating_texts + 1] = combat.make_floating_text(("-%d"):format(math.floor(pr.damage + 0.5)), pr.to, combat.TAKEN_TEXT_COLOR, now)
			end
			if not (pr.friendly and pr.target_kind == "mob") then
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
			p.target = nil
		else
			local dx = p.target.x - p.pos.x
			local dy = p.target.y - p.pos.y
			local speed = p.intro_phase == "enter" and combat.INTRO_WALK_SPEED or combat.PLAYER_SPEED
			local ratio = math.min(1, speed * dt / d)
			p.pos = { x = p.pos.x + dx * ratio, y = p.pos.y + dy * ratio }
			p.facing = combat.facing_from_delta(dx, dy)
			moving = true
		end
	end

	p.anim_time = p.anim_time + dt

	-- Not while running in: he starts below the bottom edge on purpose.
	if p.intro_phase ~= "enter" then
		p.pos.x = math.max(combat.PLAYER_RADIUS, math.min(SCREEN_W - combat.PLAYER_RADIUS, p.pos.x))
		p.pos.y = math.max(combat.PLAYER_RADIUS, math.min(PLAY_H - combat.PLAYER_RADIUS, p.pos.y))
	end

	p.mana = math.min(effective_max_mana, p.mana + (combat.MANA_REGEN_PER_SEC + manaregen_bonus) * dt)
	if s.die_timer == nil then
		p.hp = math.min(p.max_hp + hp_bonus, p.hp + hpregen_bonus * dt)
	end
	p.attack_cooldown = math.max(0, p.attack_cooldown - dt)
	p.haste_timer = math.max(0, p.haste_timer - dt)

	-- Ground item pickup (walk into it) -> first free equipped slot, else bag.
	local remaining_items = {}
	for _, it in ipairs(s.ground_items) do
		if now - it.created_at < items.ITEM_DESPAWN then
			local picked = false
			if combat.dist(p.pos, it.pos) <= items.ITEM_PICKUP_RADIUS then
				for i = 1, items.EQUIP_SLOTS do
					if not s.equipped[i] then
						s.equipped[i] = it.item
						picked = true
						break
					end
				end
				if not picked then
					for i = 1, items.BAG_SLOTS do
						if not s.bag[i] then
							s.bag[i] = it.item
							picked = true
							break
						end
					end
				end
			end
			if not picked then remaining_items[#remaining_items + 1] = it end
		end
	end
	s.ground_items = remaining_items

	local passive_now = s.passive
	local ability3_level = equipped_level_of(s, "ranged")
	local pierce_level = (passive_now and passive_now.skill == "pierce") and passive_now.level or 0
	local ally_regen = (passive_now and passive_now.skill == "summonregen") and skills.summon_regen_per_sec(passive_now.level) or 0
	local is_ranged_attack = ability3_level > 0 or pierce_level > 0
	local pierce_extra = skills.pierce_target_count(pierce_level)
	local player_attack_range = is_ranged_attack and combat.RANGED_ATTACK_RANGE or combat.PLAYER_ATTACK_RANGE
	local player_damage = combat.PLAYER_BASE_DAMAGE + skills.ability3_damage_bonus(ability3_level) + dmg_bonus
	local attack_cooldown_duration = (combat.PLAYER_ATTACK_COOLDOWN * (p.haste_timer > 0 and 0.5 or 1)) / (1 + atkspd_bonus)
	local attack_anim_speed = math.max(1, combat.anim_duration(combat.ANIMS.attack) / attack_cooldown_duration)

	local xp_gain = 0

	-- Mob AI.
	for _, m in ipairs(s.mobs) do
		m.attack_cooldown = math.max(0, m.attack_cooldown - dt)
		m.anim_time = m.anim_time + dt
		m.flash_time = math.max(0, m.flash_time - dt)
		m.hurt_gap = math.max(0, m.hurt_gap - dt)
		if (m.burn_dps or 0) > 0 and m.hp > 0 then m.hp = m.hp - m.burn_dps * dt end

		-- The shove from the last blow, bleeding off. Held inside the field.
		if m.knock.x ~= 0 or m.knock.y ~= 0 then
			m.pos = {
				x = math.min(SCREEN_W - m.radius, math.max(m.radius, m.pos.x + m.knock.x * dt)),
				y = math.min(PLAY_H - m.radius, math.max(m.radius, m.pos.y + m.knock.y * dt)),
			}
			local fade = math.exp(-dt / combat.KNOCKBACK_TAU)
			m.knock = { x = m.knock.x * fade, y = m.knock.y * fade }
			if math.sqrt(m.knock.x ^ 2 + m.knock.y ^ 2) < combat.KNOCKBACK_STOP then
				m.knock = { x = 0, y = 0 }
			end
		end

		local mob_busy = (not combat.MOB_ANIMS[m.anim].loop) and m.anim_time < combat.anim_duration(combat.MOB_ANIMS[m.anim])
		local function set_mob_anim(next_anim)
			if mob_busy then return end
			if next_anim ~= m.anim or not combat.MOB_ANIMS[next_anim].loop then m.anim_time = 0 end
			m.anim = next_anim
		end
		local detect = m.type == "boss" and 99999 or (m.type == "ranged" and 260 or combat.RANGED_ATTACK_RANGE)

		local nearest, nearest_dist = nil, math.huge
		local d_to_player = combat.dist(m.pos, p.pos)
		if d_to_player <= detect then
			nearest = { kind = "player", pos = p.pos }
			nearest_dist = d_to_player
		end
		for _, a in ipairs(s.allies) do
			if a.hp > 0 then
				local d_to_ally = combat.dist(m.pos, a.pos)
				if d_to_ally <= detect and d_to_ally < nearest_dist then
					nearest = { kind = "ally", id = a.id, pos = a.pos }
					nearest_dist = d_to_ally
				end
			end
		end

		if not nearest then
			m.pos = { x = m.pos.x, y = m.pos.y + combat.MOB_SPEED * 0.5 * dt }
			m.facing = combat.facing_from_delta(0, 1)
			set_mob_anim("walk")
		else
			m.facing = combat.facing_from_delta(nearest.pos.x - m.pos.x, nearest.pos.y - m.pos.y)

			if m.type == "ranged" then
				if nearest_dist <= combat.MOB_RANGED_FIRE_RANGE then
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
							target_kind = nearest.kind == "player" and "player" or "ally",
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
				if nearest_dist <= contact then
					if m.attack_cooldown <= 0 then
						if nearest.kind == "player" then
							damage_to_player = damage_to_player + m.damage
							s.hit_flashes[#s.hit_flashes + 1] = { id = next_id("flash"), pos = { x = p.pos.x, y = p.pos.y }, created_at = now }
							s.floating_texts[#s.floating_texts + 1] = combat.make_floating_text(("-%d"):format(m.damage), p.pos, combat.TAKEN_TEXT_COLOR, now)
						else
							for _, a in ipairs(s.allies) do
								if a.id == nearest.id then
									a.hp = a.hp - m.damage
									s.hit_flashes[#s.hit_flashes + 1] = { id = next_id("flash"), pos = { x = a.pos.x, y = a.pos.y }, created_at = now }
									s.floating_texts[#s.floating_texts + 1] = combat.make_floating_text(("-%d"):format(m.damage), a.pos, combat.TAKEN_TEXT_COLOR, now)
									break
								end
							end
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
	if p.attack_cooldown <= 0 and s.die_timer == nil then
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
					pierce = pierce_extra,
				}
				p.attack_cooldown = attack_cooldown_duration
				player_attacked = true
			end
		else
			local hit_any = false
			for _, m in ipairs(s.mobs) do
				if m.hp > 0 and combat.dist(m.pos, p.pos) <= player_attack_range + (m.radius - combat.MOB_RADIUS) then
					m.hp = m.hp - player_damage
					combat.hurt_mob(m, swing_hidden and nil or p.pos)
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
									damage = a.damage,
									friendly = true,
									target_kind = "mob",
									target_id = mob.id,
								}
							else
								mob.hp = mob.hp - a.damage
								combat.hurt_mob(mob, a.pos)
								s.hit_flashes[#s.hit_flashes + 1] = { id = next_id("flash"), pos = { x = mob.pos.x, y = mob.pos.y }, created_at = now }
								s.floating_texts[#s.floating_texts + 1] = combat.make_floating_text(("-%d"):format(a.damage), mob.pos, combat.DAMAGE_TEXT_COLOR, now)
							end
						end
						a.attack_cooldown = combat.ALLY_ATTACK_COOLDOWN
					end
				else
					local dx = nearest.pos.x - a.pos.x
					local dy = nearest.pos.y - a.pos.y
					local ratio = math.min(1, combat.ALLY_SPEED * dt / d)
					a.pos = { x = a.pos.x + dx * ratio, y = a.pos.y + dy * ratio }
				end
			end
		end
	end

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
					combat.hurt_mob(m) -- no from-point: the cone never shoved anyone
					s.floating_texts[#s.floating_texts + 1] = combat.make_floating_text(("-%d"):format(math.floor(h.amount + 0.5)), m.pos, combat.DAMAGE_TEXT_COLOR, now)
					s.hit_flashes[#s.hit_flashes + 1] = { id = next_id("flash"), pos = { x = m.pos.x, y = m.pos.y }, created_at = now }
				end
			end
		end
		s.cone_hits = still_carried
	end

	-- Burning enemies blow up when they die, in a chain.
	do
		local pending = {}
		for _, m in ipairs(s.mobs) do
			if m.hp <= 0 and (m.burn_pct or 0) > 0 then pending[#pending + 1] = m end
		end
		local exploded = {}
		while #pending > 0 do
			local src = table.remove(pending, 1)
			if not exploded[src.id] then
				exploded[src.id] = true
				local blast = src.max_hp * (src.burn_pct or 0)
				s.floating_texts[#s.floating_texts + 1] = combat.make_floating_text("boom!", src.pos, { 1, 0.439, 0.263 }, now)
				for _, m in ipairs(s.mobs) do
					if m.id ~= src.id and m.hp > 0 and combat.dist(m.pos, src.pos) <= skills.BURN_EXPLODE_RADIUS then
						m.hp = m.hp - blast
						s.hit_flashes[#s.hit_flashes + 1] = { id = next_id("flash"), pos = { x = m.pos.x, y = m.pos.y }, created_at = now }
						s.floating_texts[#s.floating_texts + 1] = combat.make_floating_text(("-%d"):format(math.floor(blast + 0.5)), m.pos, combat.DAMAGE_TEXT_COLOR, now)
						if m.hp <= 0 and (m.burn_pct or 0) > 0 and not exploded[m.id] then
							pending[#pending + 1] = m
						end
					end
				end
			end
		end
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
			if m.type == "melee" then
				s.corpses[#s.corpses + 1] = {
					id = next_id("corpse"), pos = { x = m.pos.x, y = m.pos.y }, facing = m.facing,
					anim = math.random() < 0.5 and "die" or "die2", age = 0,
				}
			end
			s.blood[#s.blood + 1] = {
				id = next_id("blood"), pos = { x = m.pos.x, y = m.pos.y },
				variant = math.random(0, combat.BLOOD_VARIANTS - 1), created_at = now,
			}
			local reward = m.type == "boss" and combat.BOSS_XP_REWARD or combat.MOB_XP_REWARD
			xp_gain = xp_gain + reward
			s.floating_texts[#s.floating_texts + 1] = combat.make_floating_text(("+%d XP"):format(reward), m.pos, combat.XP_TEXT_COLOR, now)
			local coins = m.type == "boss" and combat.BOSS_COINS or (math.random() < combat.MOB_COIN_CHANCE and 1 or 0)
			if coins > 0 then emit(s, { type = "coins", count = coins }) end
		end
	end
	s.mobs = survivor_mobs
	local survivor_allies = {}
	for _, a in ipairs(s.allies) do
		if a.hp > 0 then survivor_allies[#survivor_allies + 1] = a end
	end
	s.allies = survivor_allies

	if damage_to_player > 0 then p.hp = math.max(0, p.hp - damage_to_player) end

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
							combat.shove_mob(m, p.pos)
						end
					end
				end
			end
		end
	end

	if xp_gain > 0 then
		p.xp = p.xp + xp_gain
		while p.xp >= p.xp_to_next do
			p.xp = p.xp - p.xp_to_next
			p.level = p.level + 1
			p.xp_to_next = combat.xp_for_level(p.level)
			local old_max = p.max_hp
			p.max_hp = p.max_hp + 10
			p.hp = p.hp * (p.max_hp / old_max)
		end
	end

	-- Wave spawning: every wave still spawning keeps its own timer.
	if s.wave_active and #s.wave_queues > 0 then
		local still_spawning = {}
		for _, entry in ipairs(s.wave_queues) do
			entry.timer = entry.timer + dt
			if entry.timer >= combat.WAVE_SPAWN_INTERVAL then
				entry.timer = entry.timer - combat.WAVE_SPAWN_INTERVAL
				local mob_type = table.remove(entry.types, 1)
				if mob_type then s.mobs[#s.mobs + 1] = combat.spawn_mob(mob_type, entry.wave) end
			end
			if #entry.types > 0 then still_spawning[#still_spawning + 1] = entry end
		end
		s.wave_queues = still_spawning
		if #s.wave_queues == 0 then s.wave_active = false end
	end

	-- Each owed wave clears on its own: loot drops, gold counts, full heal.
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
				s.ground_items[#s.ground_items + 1] = items.spawn_loot(w, now)
				wave_just_cleared = true
				s.highest_wave_cleared = math.max(s.highest_wave_cleared, w)
			else
				still_owed[#still_owed + 1] = w
			end
		end
		s.loot_owed = still_owed
		if wave_just_cleared then
			p.hp = p.max_hp + hp_bonus
			p.mana = effective_max_mana
		end
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
	local cone_zone_life = skills.CONE_RANGE / skills.CONE_ZONE.sweep_speed + skills.CONE_ZONE.cell_life + 0.08
	s.cone_zones = sweep(s.cone_zones, function(z) return now < z.start_at + cone_zone_life end)
	s.skill_marks = sweep(s.skill_marks, function(m) return now - m.created_at < combat.SKILL_MARK_DURATION end)
	s.floating_texts = sweep(s.floating_texts, function(f) return now - f.created_at < combat.FLOATING_TEXT_DURATION end)

	-- The game over waits for the fall.
	local is_game_over = p.hp <= 0 and s.die_timer ~= nil and s.die_timer <= 0
	if is_game_over then
		s.game_over = true
		emit(s, { type = "game_over" })
	elseif wave_just_cleared and not s.is_test_run and s.run_id then
		emit(s, {
			type = "autosave",
			save = {
				id = s.run_id,
				saved_at = os.time(),
				wave = s.wave,
				level = p.level,
				xp = p.xp,
				xp_to_next = p.xp_to_next,
				hp = p.hp,
				max_hp = p.max_hp,
				mana = p.mana,
				abilities = s.abilities,
				passive = s.passive,
				equipped = s.equipped,
				bag = s.bag,
				materials = s.materials,
			},
		})
	end
end

return M
