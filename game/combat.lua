-- Combat constants and pure functions, ported from combat.tsx.
local layout = require("game.layout")

local M = {}

local SCREEN_W = layout.SCREEN_W
local PLAY_H = layout.PLAY_H

M.PLAYER_RADIUS = 18
M.PLAYER_SPEED = 170
M.PLAYER_TOP_BUFFER = 72
M.PLAYER_HEALTH_REGEN = 2

M.SPRITE_CELL = 128
M.SPRITE_COLS = 15
M.SPRITE_ROWS = 8
M.PLAYER_SPRITE_SIZE = 128
M.PLAYER_SPRITE_FOOT_OFFSET = 49

M.INTRO_START_LEFT = 140
M.INTRO_STOP_FROM_LEFT = 160
M.INTRO_WALK_SPEED = 80
M.STEPS_PER_CYCLE = 2
M.WALK_STRIDE = 40
M.FOOTSTEP_PHASE = 0.4
M.INTRO_SETTLE = 0.1
M.INTRO_HOLD_FRAME = M.SPRITE_COLS - 1

M.ATTACK_FROM = 5
M.ATTACK_STRIKE_FRAME = 8

-- Animation definitions. `sheet` is the tilesource anim prefix handled by the
-- view layer; the timeline fields mirror the AnimDef shape from combat.tsx.
M.ANIMS = {
	idle = { fps = 10, loop = true },
	walk = { fps = 12, loop = true },
	run = { fps = 16, loop = true },
	attack = { fps = 24, loop = false, from = M.ATTACK_FROM },
	hurt = { fps = 22, loop = false },
	spawn = { fps = 16, loop = false, interrupted_by_moving = true },
	kick = { fps = 22, loop = false, interrupted_by_moving = true },
	die = { fps = 14, loop = false },
	rupture = {
		fps = 18, loop = false, interrupted_by_moving = true,
		-- Nicolai's choreography of 20 July, verbatim from the React source.
		order = {
			0, 1, 2, 3, 4, 5,
			{ frame = 6, hold = 0.3 },
			7, 8, 9, 10,
			11, 12, 11, 12, 11,
			{ frame = 12, hold = 0.5 },
			13, 14,
		},
	},
	ancestor = { fps = 18, loop = false, interrupted_by_moving = true, passes = { "fwd", "rev", "fwd" } },
}

M.KICK_RANGE = 70
M.KICK_ARC_COS = 0.5
M.KICK_CONTACT_FRAME = 6
M.KICK_CHANCE = 0.5
M.DIE_HOLD = 0.45

M.MOB_ANIMS = {
	walk = { fps = 12, loop = true },
	attack = { fps = 16, loop = false },
	attack2 = { fps = 16, loop = false },
	attack3 = { fps = 16, loop = false },
	hurt = { fps = 20, loop = false },
}
M.MOB_DIE_ANIMS = {
	die = { fps = 14, loop = false },
	die2 = { fps = 14, loop = false },
}
M.CORPSE_LINGER = 1.4
M.CORPSE_FADE = 0.6

M.MOB_FLASH_TIME = 0.12
M.MOB_FLASH_STRENGTH = 0.75
M.MOB_HURT_ANIM_MIN_GAP = 1.4
M.MOB_ATTACK_ANIMS = { "attack", "attack2", "attack3" }

M.BLOOD_VARIANTS = 5
M.BLOOD_ANIM = { fps = 20, loop = false }
M.BLOOD_DURATION = M.SPRITE_COLS / M.BLOOD_ANIM.fps
M.BLOOD_SIZE = 128

M.MOB_SPRITE_SIZE = 128
M.MOB_SPRITE_FOOT_OFFSET = 44

M.KILL_SFX_CHANCE = 0.3
M.GORE_EXTRA_SPLATS = 3
M.GORE_SPLATTER_SPREAD = 32
M.HURT_ANIM_MIN_GAP = 1.2

-- Timeline helpers ----------------------------------------------------------

function M.anim_span(a)
	return M.SPRITE_COLS - (a.from or 0)
end

local function has_timeline(a)
	return (a.holds and #a.holds > 0) or a.passes ~= nil or a.order ~= nil
end
M.has_timeline = has_timeline

local function hold_for(a, frame)
	if not a.holds then return 0 end
	for _, h in ipairs(a.holds) do
		if h.frame == frame then return h.seconds end
	end
	return 0
end
M.hold_for = hold_for

-- Compiled play order, cached per definition (same as playSteps in React).
local steps_cache = setmetatable({}, { __mode = "k" })
function M.play_steps(a)
	local steps = steps_cache[a]
	if steps then return steps end
	local base = 1 / a.fps
	steps = {}
	if a.order then
		for _, s in ipairs(a.order) do
			if type(s) == "number" then
				steps[#steps + 1] = { frame = s, dwell = base }
			else
				steps[#steps + 1] = { frame = s.frame, dwell = base + s.hold }
			end
		end
	else
		local span = M.anim_span(a)
		local frames = {}
		for _, p in ipairs(a.passes or { "fwd" }) do
			local pass = {}
			for i = 0, span - 1 do
				pass[#pass + 1] = (p == "fwd") and i or (span - 1 - i)
			end
			-- Never repeat the junction frame between passes.
			if #frames > 0 and frames[#frames] == pass[1] then
				table.remove(pass, 1)
			end
			for _, f in ipairs(pass) do frames[#frames + 1] = f end
		end
		for _, f in ipairs(frames) do
			steps[#steps + 1] = { frame = f, dwell = base + hold_for(a, f) }
		end
	end
	steps_cache[a] = steps
	return steps
end

function M.anim_duration(a)
	if not has_timeline(a) then return M.anim_span(a) / a.fps end
	local d = 0
	for _, s in ipairs(M.play_steps(a)) do d = d + s.dwell end
	return d
end

function M.frame_start_time(a, frame)
	local t = 0
	for _, s in ipairs(M.play_steps(a)) do
		if s.frame == frame then return t end
		t = t + s.dwell
	end
	return 0
end

-- Column of the sheet to draw at a given time into the animation.
function M.anim_column(a, anim_time)
	local from = a.from or 0
	if has_timeline(a) then
		local steps = M.play_steps(a)
		local t = a.loop and (anim_time % M.anim_duration(a)) or anim_time
		local i = 1
		while i < #steps and t >= steps[i].dwell do
			t = t - steps[i].dwell
			i = i + 1
		end
		return from + steps[i].frame
	end
	local span = M.anim_span(a)
	local frame = math.floor(anim_time * a.fps)
	if a.loop then
		return from + frame % span
	end
	return from + math.min(frame, span - 1)
end

-- Facing math ----------------------------------------------------------------
-- Row order down each sheet is E, SE, S, SW, W, NW, N, NE (sim y points down).

M.SPRITE_ROW_FOR_EAST = 0

function M.dist(a, b)
	local dx, dy = a.x - b.x, a.y - b.y
	return math.sqrt(dx * dx + dy * dy)
end

function M.normalize_angle(deg)
	local d = deg
	while d > 180 do d = d - 360 end
	while d < -180 do d = d + 360 end
	return d
end

function M.facing_from_delta(dx, dy)
	local eighths = math.floor(math.atan2(dy, dx) / (math.pi / 4) + 0.5)
	return ((M.SPRITE_ROW_FOR_EAST + eighths) % M.SPRITE_ROWS + M.SPRITE_ROWS) % M.SPRITE_ROWS
end

function M.facing_vector(facing)
	local a = facing * math.pi / 4
	return { x = math.cos(a), y = math.sin(a) }
end

function M.direction_from_facing(facing)
	local angle = (facing - M.SPRITE_ROW_FOR_EAST) * math.pi / 4
	return { x = math.cos(angle), y = math.sin(angle) }
end

-- Nearest wins, except a target already dead ahead keeps the current facing.
function M.facing_for_targets(from, targets, current)
	local best, best_dist = nil, math.huge
	for _, t in ipairs(targets) do
		if M.facing_from_delta(t.x - from.x, t.y - from.y) == current then
			return current
		end
		local d = M.dist(from, t)
		if d < best_dist then
			best_dist = d
			best = t
		end
	end
	if best then return M.facing_from_delta(best.x - from.x, best.y - from.y) end
	return current
end

M.INTRO_WALK_ANIM = (M.SPRITE_COLS / M.ANIMS.walk.fps)
	/ ((M.STEPS_PER_CYCLE * M.WALK_STRIDE) / M.INTRO_WALK_SPEED)

-- Combat numbers -------------------------------------------------------------

M.PLAYER_ATTACK_RANGE = 60
M.RANGED_ATTACK_RANGE = 240
M.PLAYER_ATTACK_COOLDOWN = 0.8
M.PLAYER_BASE_DAMAGE = 8

M.MOB_RADIUS = 14
M.BOSS_RADIUS = 26
M.MOB_SPEED = 60
M.MOB_ATTACK_RANGE = 40
M.MOB_RANGED_FIRE_RANGE = 170
M.MOB_ATTACK_COOLDOWN = 1.2
M.MOB_MAX_HP = 20
M.MOB_DAMAGE = 2
M.MOB_XP_REWARD = 15
M.BOSS_XP_REWARD = 120
M.MOB_COIN_CHANCE = 0.5
M.BOSS_COINS = 5

M.KNOCKBACK_SPEED = 260
M.KNOCKBACK_VARIATION = 0.45
M.KNOCKBACK_TAU = 0.085
M.KNOCKBACK_STOP = 8

M.WAVE_SPAWN_INTERVAL = 2.0 -- twice the previous gap between each mob spawn

M.ALLY_RADIUS = 12
M.ALLY_SPEED = 90
M.ALLY_ATTACK_RANGE = 50
M.ALLY_ENGAGE_RANGE = 200
M.ALLY_RANGED_ATTACK_RANGE = 160
M.ALLY_RANGED_ENGAGE_RANGE = 260
M.ALLY_ATTACK_COOLDOWN = 1.0

M.PROJECTILE_SPEED = 700
M.HIT_FLASH_DURATION = 0.15
M.SKILL_MARK_DURATION = 0.7
M.FLOATING_TEXT_DURATION = 0.7
M.FLOATING_TEXT_RISE = 32

M.SWING_STRIKE_AT = (M.ATTACK_STRIKE_FRAME - M.ATTACK_FROM) / M.ANIMS.attack.fps

M.MOB_TYPE_META = {
	melee = { name = "Melee", color = { 0.878, 0.333, 0.333 }, radius = M.MOB_RADIUS },
	ranged = { name = "Ranged", color = { 1.0, 0.596, 0.0 }, radius = M.MOB_RADIUS },
	boss = { name = "Boss", color = { 0.671, 0.278, 0.737 }, radius = M.BOSS_RADIUS },
}

M.DAMAGE_TEXT_COLOR = { 1, 1, 1 }
M.TAKEN_TEXT_COLOR = { 1, 0.322, 0.322 }
M.XP_TEXT_COLOR = { 1, 0.835, 0.31 }


-- Mutators -------------------------------------------------------------------

function M.shove_mob(m, from, max_range)
	local dx = m.pos.x - from.x
	local dy = m.pos.y - from.y
	local len = math.sqrt(dx * dx + dy * dy)
	if len > 0.001 then
		-- Player shoves fade linearly with distance: strongest up close and zero
		-- at the edge of the attack. The sim also uses this limit as a hard stop
		-- so frame timing and random variation can never carry the mob past it.
		local proximity = 1
		if max_range then
			proximity = math.max(0, math.min(1, (max_range - len) / max_range))
			m.knock_limit = { x = from.x, y = from.y, range = max_range }
		else
			m.knock_limit = nil
		end
		local vary = 1 + (math.random() * 2 - 1) * M.KNOCKBACK_VARIATION
		local speed = M.KNOCKBACK_SPEED * proximity * vary * (M.MOB_RADIUS / m.radius)
		m.knock = { x = dx / len * speed, y = dy / len * speed }
		if speed <= 0 then m.knock_limit = nil end
	end
end

function M.hurt_mob(m, from, max_shove_range)
	m.flash_time = M.MOB_FLASH_TIME
	if from then M.shove_mob(m, from, max_shove_range) end
	local def = M.MOB_ANIMS[m.anim]
	local busy = (not def.loop) and m.anim_time < M.anim_duration(def)
	if not busy and m.hurt_gap <= 0 then
		m.anim = "hurt"
		m.anim_time = 0
		m.hurt_gap = M.MOB_HURT_ANIM_MIN_GAP
	end
end

function M.make_player()
	local entrance_y = (M.PLAYER_RADIUS + M.PLAYER_TOP_BUFFER
		+ PLAY_H - M.PLAYER_RADIUS) / 2
	return {
		pos = { x = -M.INTRO_START_LEFT, y = entrance_y },
		target = { x = M.INTRO_STOP_FROM_LEFT, y = entrance_y },
		hp = 100,
		max_hp = 100,
		attack_cooldown = 0,
		haste_timer = 0,
		facing = 0, -- east, the way he is about to walk in
		anim = "walk",
		anim_time = 0,
		anim_speed = M.INTRO_WALK_ANIM,
		intro_phase = "enter",
		intro_timer = 0,
	}
end

local mob_id_counter = 0
local ally_id_counter = 0
local floating_text_id_counter = 0

function M.mob_hp_for_wave(_wave) return M.MOB_MAX_HP end
function M.mob_damage_for_wave(_wave) return M.MOB_DAMAGE end
function M.ranged_damage_for_wave(_wave) return 3 end
function M.mob_count_for_wave(wave) return 4 + wave end

-- Bosses arrive on wave 3 and every third wave after (3, 6, 9, ...), each a
-- tier stronger than the last.
function M.boss_tier_for_wave(wave)
	if wave >= 3 and wave % 3 == 0 then
		return wave / 3
	end
	return 0
end

function M.ranged_count_for_wave(wave)
	if wave < 3 then return 0 end
	return math.min(math.floor(M.mob_count_for_wave(wave) / 2), wave - 2)
end

function M.mob_type_stats(mob_type, wave)
	local melee_hp = M.mob_hp_for_wave(wave)
	local melee_dmg = M.mob_damage_for_wave(wave)
	if mob_type == "melee" then return { hp = melee_hp, damage = melee_dmg } end
	if mob_type == "ranged" then
		return { hp = math.floor(melee_hp * 0.7 + 0.5), damage = M.ranged_damage_for_wave(wave) }
	end
	-- Bosses keep their first-encounter stats at every tier.
	return { hp = 530, damage = 12 }
end

function M.wave_composition(wave)
	local total = M.mob_count_for_wave(wave)
	local ranged = M.ranged_count_for_wave(wave)
	local melee = total - ranged
	local rows = {}
	if melee > 0 then rows[#rows + 1] = { type = "melee", count = melee } end
	if ranged > 0 then rows[#rows + 1] = { type = "ranged", count = ranged } end
	if M.boss_tier_for_wave(wave) > 0 then rows[#rows + 1] = { type = "boss", count = 1 } end
	return rows
end

function M.build_wave_queue(wave)
	local total = M.mob_count_for_wave(wave)
	local ranged = M.ranged_count_for_wave(wave)
	local melee = total - ranged
	local queue = {}
	for _ = 1, melee do queue[#queue + 1] = "melee" end
	for _ = 1, ranged do queue[#queue + 1] = "ranged" end
	for i = #queue, 2, -1 do
		local j = math.random(i)
		queue[i], queue[j] = queue[j], queue[i]
	end
	if M.boss_tier_for_wave(wave) > 0 then queue[#queue + 1] = "boss" end
	return queue
end

function M.spawn_mob(mob_type, wave)
	mob_id_counter = mob_id_counter + 1
	local meta = M.MOB_TYPE_META[mob_type]
	local stats = M.mob_type_stats(mob_type, wave)
	local margin = meta.radius + 4
	local min_y = meta.radius + M.PLAYER_TOP_BUFFER
	local max_y = PLAY_H - meta.radius
	return {
		id = mob_id_counter,
		type = mob_type,
		wave = wave,
		pos = {
			x = SCREEN_W - margin,
			y = min_y + math.random() * math.max(0, max_y - min_y),
		},
		hp = stats.hp,
		max_hp = stats.hp,
		damage = stats.damage,
		radius = meta.radius,
		attack_cooldown = 0,
		facing = 4, -- west: spawned at the right edge walking left
		anim = "walk",
		anim_time = 0,
		flash_time = 0,
		hurt_gap = 0,
		knock = { x = 0, y = 0 },
	}
end

function M.make_allies_for_level(level, origin, ability1_stats)
	local count = 1
	local stats = ability1_stats(level)
	local result = {}
	for i = 0, count - 1 do
		ally_id_counter = ally_id_counter + 1
		local offset_x = (i - (count - 1) / 2) * 36
		local ranged = false
		result[#result + 1] = {
			id = ally_id_counter,
			pos = {
				x = math.max(M.ALLY_RADIUS, math.min(SCREEN_W - M.ALLY_RADIUS, origin.x + offset_x)),
				y = math.max(M.ALLY_RADIUS + M.PLAYER_TOP_BUFFER,
					math.min(PLAY_H - M.ALLY_RADIUS, origin.y - 50)),
			},
			hp = stats.hp,
			max_hp = stats.hp,
			damage = stats.damage,
			attack_cooldown = 0,
			ranged = ranged,
			source_skill = "summon",
		}
	end
	return result
end

function M.make_seagull(level, origin, seagull_stats)
	ally_id_counter = ally_id_counter + 1
	local stats = seagull_stats(level)
	return {
		id = ally_id_counter,
		pos = {
			x = math.max(M.ALLY_RADIUS, math.min(SCREEN_W - M.ALLY_RADIUS, origin.x)),
			y = math.max(M.ALLY_RADIUS + M.PLAYER_TOP_BUFFER,
				math.min(PLAY_H - M.ALLY_RADIUS, origin.y - 50)),
		},
		hp = stats.hp,
		max_hp = stats.hp,
		damage = stats.damage,
		attack_cooldown = 0,
		ranged = true,
		flying = true,
		source_skill = "seagull",
	}
end

function M.make_floating_text(text, pos, color, now)
	floating_text_id_counter = floating_text_id_counter + 1
	return { id = floating_text_id_counter, text = text, pos = { x = pos.x, y = pos.y }, color = color, created_at = now }
end

return M
