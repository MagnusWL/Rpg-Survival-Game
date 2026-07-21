-- Skill catalog, stat curves and cone math, ported from skills.tsx.
-- Passives (Summon Regen, Haste, Pierce) have moved to game.upgrades; every
-- skill here is an active, one root plus one child per tree.
local layout = require("game.layout")
local combat = require("game.combat")

local M = {}

M.ABILITY_MAX_LEVEL = 4
M.CONE_RANGE = math.sqrt(layout.SCREEN_W ^ 2 + layout.PLAY_H ^ 2)
M.ABILITY2_HALF_ANGLE_DEG = 21
M.ABILITY3_HASTE_DURATION = 5

-- Cone-zone effect timing (the visual wave the damage rides).
M.CONE_ZONE = {
	cell_life = 1.5, -- seconds
	drift = 16,
	sweep_speed = 1100, -- px/s the wave front travels at
	delay_step = 0.015,
}
M.CONE_DAMAGE_RIDES_WAVE = true

-- Picture of the cast the ground answers on: his 13th frame of the rupture.
M.RUPTURE_ZONE_FRAME = 12
M.RUPTURE_ZONE_DELAY = combat.frame_start_time(combat.ANIMS.rupture, M.RUPTURE_ZONE_FRAME)

M.ALL_SKILLS = { "summon", "cone", "ranged", "fireball", "burn", "push" }
M.ROOT_SKILLS = { "summon", "cone", "ranged" }
M.MAX_EQUIPPED = 3

M.SKILL_PARENT = {
	summon = nil, cone = nil, ranged = nil,
	fireball = "summon", burn = "cone", push = "ranged",
}

M.SKILL_META = {
	summon = { label = "Summon", icon = "Z", color = { 0.494, 0.341, 0.761 }, cast = "instant", cooldown = 12 },
	cone = { label = "Cone", icon = "V", color = { 1.0, 0.541, 0.314 }, cast = "instant", cooldown = 5 },
	ranged = { label = "Ranged", icon = "R", color = { 0.4, 0.733, 0.416 }, cast = "instant", cooldown = 15 },
	fireball = { label = "Fireball", icon = "F", color = { 0.361, 0.42, 0.753 }, cast = "instant", cooldown = 8 },
	burn = { label = "Burn", icon = "B", color = { 0.937, 0.325, 0.314 }, cast = "instant", cooldown = 6 },
	push = { label = "Push", icon = "P", color = { 0.263, 0.627, 0.278 }, cast = "instant", cooldown = 8 },
}

-- Per-skill progression: every skill starts owned at rank 1 and ranks up on
-- this curve from two income streams (see game.sim) -- half from clearing
-- waves regardless of what you did, half from kills the skill itself lands.
M.SKILL_XP_PER_LEVEL = { 150, 400, 900 } -- rank 1->2, 2->3, 3->4
function M.skill_xp_to_next(level)
	return M.SKILL_XP_PER_LEVEL[level]
end

local function pick(t, level) return t[level] or 0 end

function M.fireball_damage_percent(level) return pick({ 1.0, 1.5, 2.0, 2.5 }, level) end
M.FIREBALL_RADIUS = 95
function M.burn_explode_percent(level) return pick({ 0.5, 0.6, 0.7, 1.0 }, level) end
M.BURN_EXPLODE_RADIUS = 90
function M.burn_damage_per_sec(level) return pick({ 5, 10, 15, 20 }, level) end
function M.push_damage_percent(level) return pick({ 0.5, 1.0, 1.5, 2.0 }, level) end
M.PUSH_SPEED = 620
-- How close to a pierced shot's line an enemy must be to be swept up in it.
M.PIERCE_WIDTH = 26

function M.ability1_stats(level)
	return { hp = 20 + (level - 1) * 15, damage = 4 + (level - 1) * 3 }
end
function M.ability2_base_damage(level) return 10 * level end
function M.ability2_damage_percent(level) return 0.1 + (level - 1) * 0.05 end
function M.ability3_damage_bonus(level) return level * 4 end

function M.nearest_target(from, targets, max_range)
	local best, best_dist = nil, math.huge
	for _, t in ipairs(targets) do
		local d = combat.dist(from, t.pos)
		if d <= max_range and d < best_dist then
			best_dist = d
			best = t
		end
	end
	return best
end

-- The cone's aim and arithmetic. Damage is not applied here; the caller
-- delivers the returned hits (immediately, or riding the wave).
function M.fire_cone(origin, aim_point, mobs, base_damage, damage_percent, range, half_angle_deg)
	local dir_angle = math.atan2(aim_point.y - origin.y, aim_point.x - origin.x) * 180 / math.pi
	local hits = {}
	for _, m in ipairs(mobs) do
		local d = combat.dist(origin, m.pos)
		if d <= range then
			local mob_angle = math.atan2(m.pos.y - origin.y, m.pos.x - origin.x) * 180 / math.pi
			if math.abs(combat.normalize_angle(mob_angle - dir_angle)) <= half_angle_deg then
				local amount = base_damage + m.max_hp * damage_percent
				hits[#hits + 1] = { id = m.id, pos = { x = m.pos.x, y = m.pos.y }, amount = amount }
			end
		end
	end
	return hits
end

local ALL_LEVELS = { 1, 2, 3, 4 }

local function bracket(fn)
	local vals = {}
	for _, l in ipairs(ALL_LEVELS) do vals[#vals + 1] = tostring(fn(l)) end
	return "(" .. table.concat(vals, "/") .. ")"
end

-- The skill's own name is shown separately (as the tooltip's title line), so
-- this starts straight in on what it does -- no "Skill: " prefix to repeat it.
function M.skill_description(skill)
	if skill == "summon" then
		local hps = bracket(function(l) return M.ability1_stats(l).hp end)
		local dmgs = bracket(function(l) return M.ability1_stats(l).damage end)
		return ("Calls 1/2/3/4 allied mobs (at level 4: 2 melee, 2 ranged) that fight for you. HP %s, DMG %s."):format(hps, dmgs)
	elseif skill == "cone" then
		local bases = bracket(M.ability2_base_damage)
		local pcts = bracket(function(l) return math.floor(M.ability2_damage_percent(l) * 100 + 0.5) .. "%" end)
		return ("Deals %s damage plus %s of each enemy's max HP in a widening cone toward where you aim."):format(bases, pcts)
	elseif skill == "ranged" then
		local dmgs = bracket(M.ability3_damage_bonus)
		return ("Passively turns your attacks ranged, adding %s damage. Tap to gain +50%% attack speed for 5s."):format(dmgs)
	elseif skill == "fireball" then
		local pcts = bracket(function(l) return math.floor(M.fireball_damage_percent(l) * 100 + 0.5) .. "%" end)
		return ("A fireball explodes from every one of your summons, dealing %s of that summon's attack damage to nearby enemies. Needs Summon."):format(pcts)
	elseif skill == "burn" then
		local pcts = bracket(function(l) return math.floor(M.burn_explode_percent(l) * 100 + 0.5) .. "%" end)
		return ("Sets the closest enemy afire. When it dies it explodes, dealing %s of its max health to nearby enemies. Needs Cone."):format(pcts)
	end
	local pcts = bracket(function(l) return math.floor(M.push_damage_percent(l) * 100 + 0.5) .. "%" end)
	return ("Shoves all enemies away from you, dealing %s of your attack damage. Needs Ranged."):format(pcts)
end

function M.skill_stats_suffix(skill)
	local meta = M.SKILL_META[skill]
	return ("\nCooldown: %ds"):format(meta.cooldown)
end

return M
