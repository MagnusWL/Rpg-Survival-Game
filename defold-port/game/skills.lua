-- Skill catalog, stat curves and cone math, ported from skills.tsx.
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

M.ALL_SKILLS = {
	"summon", "cone", "ranged",
	"fireball", "burn", "push",
	"summonregen", "cdreduce", "pierce",
}
M.ROOT_SKILLS = { "summon", "cone", "ranged" }
M.MAX_EQUIPPED = 3
M.MAX_PASSIVE = 1

M.SKILL_PARENT = {
	summon = nil, cone = nil, ranged = nil,
	fireball = "summon", summonregen = "summon",
	burn = "cone", cdreduce = "cone",
	push = "ranged", pierce = "ranged",
}

M.SKILL_META = {
	summon = { label = "Summon", icon = "Z", color = { 0.494, 0.341, 0.761 }, cast = "instant", mana = 30, cooldown = 12 },
	cone = { label = "Cone", icon = "V", color = { 1.0, 0.541, 0.314 }, cast = "instant", mana = 20, cooldown = 5 },
	ranged = { label = "Ranged", icon = "R", color = { 0.4, 0.733, 0.416 }, cast = "instant", mana = 25, cooldown = 15 },
	fireball = { label = "Fireball", icon = "F", color = { 0.361, 0.42, 0.753 }, cast = "instant", mana = 25, cooldown = 8 },
	burn = { label = "Burn", icon = "B", color = { 0.937, 0.325, 0.314 }, cast = "instant", mana = 20, cooldown = 6 },
	push = { label = "Push", icon = "P", color = { 0.263, 0.627, 0.278 }, cast = "instant", mana = 20, cooldown = 8 },
	summonregen = { label = "Summon Regen", icon = "S", color = { 0.259, 0.647, 0.961 }, cast = "passive", mana = 0, cooldown = 0 },
	cdreduce = { label = "Haste", icon = "H", color = { 0.898, 0.224, 0.208 }, cast = "passive", mana = 0, cooldown = 0 },
	pierce = { label = "Pierce", icon = "X", color = { 0.992, 0.847, 0.208 }, cast = "passive", mana = 0, cooldown = 0 },
}

function M.is_passive_skill(skill)
	return M.SKILL_META[skill].cast == "passive"
end

M.SKILL_LEVEL_COST = { [0] = 0, 5, 10, 15, 20 }
function M.skill_level_cost(target_level)
	return M.SKILL_LEVEL_COST[target_level] or 0
end

local function pick(t, level) return t[level] or 0 end

function M.fireball_damage_percent(level) return pick({ 1.0, 1.5, 2.0, 2.5 }, level) end
M.FIREBALL_RADIUS = 95
function M.burn_explode_percent(level) return pick({ 0.5, 0.6, 0.7, 1.0 }, level) end
M.BURN_EXPLODE_RADIUS = 90
function M.burn_damage_per_sec(level) return pick({ 5, 10, 15, 20 }, level) end
function M.push_damage_percent(level) return pick({ 0.5, 1.0, 1.5, 2.0 }, level) end
M.PUSH_SPEED = 620
function M.summon_regen_per_sec(level) return level * 4 end
function M.cooldown_reduce_percent(level) return pick({ 0.2, 0.3, 0.4, 0.5 }, level) end
function M.pierce_target_count(level) return level > 0 and level or 0 end
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

function M.skill_description(skill)
	if skill == "summon" then
		local hps = bracket(function(l) return M.ability1_stats(l).hp end)
		local dmgs = bracket(function(l) return M.ability1_stats(l).damage end)
		return ("Summon: calls 1/2/3/4 allied mobs (at level 4: 2 melee, 2 ranged) that fight for you. HP %s, DMG %s."):format(hps, dmgs)
	elseif skill == "cone" then
		local bases = bracket(M.ability2_base_damage)
		local pcts = bracket(function(l) return math.floor(M.ability2_damage_percent(l) * 100 + 0.5) .. "%" end)
		return ("Cone: deals %s damage plus %s of each enemy's max HP in a widening cone toward where you aim."):format(bases, pcts)
	elseif skill == "ranged" then
		local dmgs = bracket(M.ability3_damage_bonus)
		return ("Ranged: passively turns your attacks ranged, adding %s damage. Tap to gain +50%% attack speed for 5s."):format(dmgs)
	elseif skill == "fireball" then
		local pcts = bracket(function(l) return math.floor(M.fireball_damage_percent(l) * 100 + 0.5) .. "%" end)
		return ("Fireball: a fireball explodes from every one of your summons, dealing %s of that summon's attack damage to nearby enemies. Needs Summon."):format(pcts)
	elseif skill == "burn" then
		local pcts = bracket(function(l) return math.floor(M.burn_explode_percent(l) * 100 + 0.5) .. "%" end)
		return ("Burn: set the closest enemy afire. When it dies it explodes, dealing %s of its max health to nearby enemies. Needs Cone."):format(pcts)
	elseif skill == "push" then
		local pcts = bracket(function(l) return math.floor(M.push_damage_percent(l) * 100 + 0.5) .. "%" end)
		return ("Push: shove all enemies away from you, dealing %s of your attack damage. Needs Ranged."):format(pcts)
	elseif skill == "summonregen" then
		local regens = bracket(function(l) return M.summon_regen_per_sec(l) .. "/s" end)
		return ("Summon Regen (passive): your summons regenerate %s health. Needs Summon."):format(regens)
	elseif skill == "cdreduce" then
		local pcts = bracket(function(l) return math.floor(M.cooldown_reduce_percent(l) * 100 + 0.5) .. "%" end)
		return ("Haste (passive): reduces the cooldown of all your skills by %s. Needs Cone."):format(pcts)
	end
	local targets = bracket(M.pierce_target_count)
	return ("Pierce (passive): your shots pierce through %s enemies. Needs Ranged."):format(targets)
end

function M.skill_stats_suffix(skill)
	local meta = M.SKILL_META[skill]
	if meta.cast == "passive" then return "\nPassive · always on while equipped" end
	return ("\nCost: %d MP  ·  Cooldown: %ds"):format(meta.mana, meta.cooldown)
end

return M
