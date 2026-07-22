-- Skill catalog, stat curves and cone math, ported from skills.tsx.
-- Passives (Summon Regen, Haste, Pierce) have moved to game.upgrades; every
-- skill here is active; roots can have multiple child branches.
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
	"summon", "cone", "ranged", "fireball", "seagull", "burn", "chainlightning",
	"push", "swordthrow",
}
M.ROOT_SKILLS = { "summon", "cone", "ranged" }
M.MAX_EQUIPPED = 3
-- Equip slots are unlocked with gold in the skill tree: slot 1 is free, slot 2
-- costs 10, slot 3 costs 20. Index is the slot number.
M.SLOT_COSTS = { 0, 10, 20 }

M.SKILL_PARENT = {
	summon = nil, cone = nil, ranged = nil,
	fireball = "summon", seagull = "summon",
	burn = "cone", chainlightning = "cone",
	push = "ranged", swordthrow = "ranged",
}

-- Ids stay the same (summon/cone/ranged) for save compatibility; only the
-- player-facing labels changed: Summon->Wild Boar, Cone->Shockwave,
-- Ranged->Berserker.
M.SKILL_META = {
	summon = { label = "Wild Boar", icon = "Z", color = { 0.494, 0.341, 0.761 }, cast = "instant", cooldown = 12 },
	cone = { label = "Shockwave", icon = "V", color = { 1.0, 0.541, 0.314 }, cast = "instant", cooldown = 5 },
	ranged = { label = "Berserker", icon = "R", color = { 0.4, 0.733, 0.416 }, cast = "instant", cooldown = 15 },
	fireball = { label = "Fire Enrage", icon = "F", color = { 0.361, 0.42, 0.753 }, cast = "instant", cooldown = 8 },
	seagull = { label = "Seagull", icon = "G", color = { 0.45, 0.75, 0.9 }, cast = "instant", cooldown = 12 },
	burn = { label = "Burn", icon = "B", color = { 0.937, 0.325, 0.314 }, cast = "instant", cooldown = 6 },
	chainlightning = { label = "Chain Lightning", icon = "L", color = { 0.45, 0.75, 1.0 }, cast = "instant", cooldown = 8 },
	push = { label = "Push", icon = "P", color = { 0.263, 0.627, 0.278 }, cast = "instant", cooldown = 8 },
	swordthrow = { label = "Sword Throw", icon = "T", color = { 0.82, 0.86, 0.95 }, cast = "instant", cooldown = 8 },
}

-- Berserker has no passive effect; these apply only during its active buff.
M.BERSERKER_LIFESTEAL = 0.5

-- Per-skill progression: every skill starts owned at rank 1 and ranks up on
-- this curve from two income streams (see game.sim) -- half from clearing
-- waves regardless of what you did, half from kills the skill itself lands.
M.SKILL_XP_PER_LEVEL = { 100, 200, 300 } -- rank 1->2, 2->3, 3->4
function M.skill_xp_to_next(level)
	return M.SKILL_XP_PER_LEVEL[level]
end

local ROMAN = { "I", "II", "III", "IV" }
function M.rank_roman(level) return ROMAN[level] or tostring(level or 0) end

local function pick(t, level) return t[level] or 0 end

-- Fire Enrage buffs every living summon with +50% attack speed and bonus fire
-- damage on each attack.
M.FIREBALL_ENRAGE_DURATION = 5
M.FIREBALL_ENRAGE_ATKSPD = 0.5
function M.fireball_attack_damage(level) return pick({ 20, 30, 40, 50 }, level) end
function M.burn_explode_damage(level) return pick({ 25, 50, 75, 100 }, level) end
M.BURN_EXPLODE_RADIUS = 140 -- widened from 90
function M.burn_damage_per_sec(level) return pick({ 2.5, 5, 7.5, 10 }, level) end
function M.push_damage_percent(level) return pick({ 0.5, 1.0, 1.5, 2.0 }, level) end
function M.chain_lightning_hits(level) return pick({ 3, 4, 5, 6 }, level) end
function M.chain_lightning_damage(level) return pick({ 25, 50, 75, 100 }, level) end
M.CHAIN_LIGHTNING_FALLOFF = 0.8
function M.sword_throw_percent(level) return pick({ 2.0, 2.5, 3.0, 3.5 }, level) end
M.PUSH_SPEED = 360 -- gentler shove, so ranged enemies aren't knocked out of reach
-- How close to a pierced shot's line an enemy must be to be swept up in it.
M.PIERCE_WIDTH = 26

function M.ability1_stats(level)
	return { hp = pick({ 80, 200, 400, 800 }, level), damage = 10 * level }
end
function M.seagull_stats(level)
	return { hp = pick({ 80, 160, 240, 320 }, level), damage = pick({ 20, 40, 60, 80 }, level) }
end
function M.ability2_base_damage(level) return 10 * level end
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
function M.fire_cone(origin, aim_point, mobs, base_damage, _damage_percent, range, half_angle_deg)
	local dir_angle = math.atan2(aim_point.y - origin.y, aim_point.x - origin.x) * 180 / math.pi
	local hits = {}
	for _, m in ipairs(mobs) do
		local d = combat.dist(origin, m.pos)
		if d <= range then
			local mob_angle = math.atan2(m.pos.y - origin.y, m.pos.x - origin.x) * 180 / math.pi
			if math.abs(combat.normalize_angle(mob_angle - dir_angle)) <= half_angle_deg then
				local amount = base_damage
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
		return ("Summons one Wild Boar at every level. HP %s, DMG %s."):format(hps, dmgs)
	elseif skill == "cone" then
		local bases = bracket(M.ability2_base_damage)
		return ("Deals %s flat damage in a widening cone. Auto-aims at the nearest enemy, turning you to face it."):format(bases)
	elseif skill == "ranged" then
		return "Tap to gain +50% attack speed and 50% lifesteal for 5s"
	elseif skill == "fireball" then
		local damage = bracket(M.fireball_attack_damage)
		return ("Enrage all summons for 5s: +50%% attack speed and %s bonus fire damage on every attack."):format(damage)
	elseif skill == "seagull" then
		local hps = bracket(function(l) return M.seagull_stats(l).hp end)
		local dmgs = bracket(function(l) return M.seagull_stats(l).damage end)
		return ("Summons one flying ranged Seagull. Only ranged enemies can damage it. HP %s, DMG %s."):format(hps, dmgs)
	elseif skill == "chainlightning" then
		local hits = bracket(M.chain_lightning_hits)
		local damage = bracket(M.chain_lightning_damage)
		return ("Chains through %s enemies for %s initial damage, reduced by 20%% after each jump."):format(hits, damage)
	elseif skill == "swordthrow" then
		local pcts = bracket(function(l) return math.floor(M.sword_throw_percent(l) * 100 + 0.5) .. "%" end)
		return ("Throws your sword at the nearest enemy for %s attack damage. A kill immediately refreshes the cooldown."):format(pcts)
	elseif skill == "burn" then
		local damage = bracket(M.burn_explode_damage)
		return ("Sets the closest enemy afire. When it dies it explodes, dealing %s flat damage to nearby enemies."):format(damage)
	end
	local pcts = bracket(function(l) return math.floor(M.push_damage_percent(l) * 100 + 0.5) .. "%" end)
	return ("Shoves all enemies away from you, dealing %s of your attack damage."):format(pcts)
end

function M.skill_stats_suffix(skill)
	local meta = M.SKILL_META[skill]
	return ("\nCooldown: %ds"):format(meta.cooldown)
end

return M
