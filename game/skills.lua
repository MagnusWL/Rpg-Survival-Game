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
	"push", "swordthrow", "drainlife", "stomp", "monsterzombie",
}
M.ROOT_SKILLS = { "summon", "burn", "ranged" }
M.MAX_EQUIPPED = 3
-- Equip slots are unlocked with gold in the skill tree: slot 1 is free, slot 2
-- costs 10, slot 3 costs 20. Index is the slot number.
M.SLOT_COSTS = { 0, 10, 20 }

-- Fireball and Shockwave swapped places: Fireball is now the root, Shockwave
-- its child. Chain Lightning also moved, now a direct child of Fireball
-- (a sibling of Shockwave) rather than Shockwave's own child; Drain Life
-- takes the third-tier slot under Shockwave instead. Sword Throw and The
-- Cure each grow their own third-tier branch too (Stomp, Monster Zombie).
M.SKILL_PARENT = {
	summon = nil, burn = nil, ranged = nil,
	fireball = "summon", seagull = "summon", monsterzombie = "seagull",
	cone = "burn", chainlightning = "burn", drainlife = "cone",
	push = "ranged", swordthrow = "ranged", stomp = "swordthrow",
}

-- Ids stay the same (summon/cone/ranged/seagull/burn/etc) for save
-- compatibility; only the player-facing labels and behavior changed:
-- Summon->Dead Again, Seagull->The Cure, Burn->Fireball (swapped with the old
-- Fireball, now Fire Enrage keeps its name), Cone stays Shockwave.
M.SKILL_META = {
	summon = { label = "Dead Again", icon = "Z", color = { 0.494, 0.341, 0.761 }, cast = "instant", cooldown = 6 },
	cone = { label = "Shockwave", icon = "V", color = { 1.0, 0.541, 0.314 }, cast = "instant", cooldown = 5 },
	ranged = { label = "Berserker", icon = "R", color = { 0.4, 0.733, 0.416 }, cast = "instant", cooldown = 10 },
	fireball = { label = "Fire Enrage", icon = "F", color = { 0.361, 0.42, 0.753 }, cast = "instant", cooldown = 8 },
	seagull = { label = "The Cure", icon = "G", color = { 0.45, 0.75, 0.9 }, cast = "instant", cooldown = 12 },
	burn = { label = "Fireball", icon = "B", color = { 0.937, 0.325, 0.314 }, cast = "instant", cooldown = 6 },
	chainlightning = { label = "Chain Lightning", icon = "L", color = { 0.45, 0.75, 1.0 }, cast = "instant", cooldown = 8 },
	push = { label = "Push", icon = "P", color = { 0.263, 0.627, 0.278 }, cast = "instant", cooldown = 8 },
	swordthrow = { label = "Sword Throw", icon = "T", color = { 0.82, 0.86, 0.95 }, cast = "instant", cooldown = 8 },
	drainlife = { label = "Drain Life", icon = "D", color = { 0.8, 0.15, 0.15 }, cast = "instant", cooldown = 20 },
	stomp = { label = "Stomp", icon = "S", color = { 0.6, 0.5, 0.35 }, cast = "instant", cooldown = 10 },
	monsterzombie = { label = "Monster Zombie", icon = "M", color = { 0.35, 0.6, 0.3 }, cast = "instant", cooldown = 25 },
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
-- damage on each attack; it also keeps them from expiring while it's up
-- (Dead Again/The Cure/Monster Zombie's summons all run on borrowed time).
M.FIREBALL_ENRAGE_DURATION = 10
M.FIREBALL_ENRAGE_ATKSPD = 0.5
function M.fireball_attack_damage(level) return pick({ 20, 30, 40, 50 }, level) end
-- Fireball: a projectile lobbed at the nearest enemy that explodes on impact.
function M.burn_explode_damage(level) return pick({ 25, 50, 75, 100 }, level) end
M.BURN_EXPLODE_RADIUS = 140 -- widened from 90
M.BURN_EXPLOSION_VISUAL_DURATION = 0.4
function M.push_damage_percent(level) return pick({ 0.5, 1.0, 1.5, 2.0 }, level) end
function M.chain_lightning_hits(level) return pick({ 3, 4, 5, 6 }, level) end
function M.chain_lightning_damage(level) return pick({ 25, 50, 75, 100 }, level) end
M.CHAIN_LIGHTNING_CAST_RANGE = layout.SCREEN_W / 3
M.CHAIN_LIGHTNING_JUMP_RANGE = layout.SCREEN_W / 5
M.CHAIN_LIGHTNING_VISUAL_DURATION = 0.28
M.CHAIN_LIGHTNING_FALLOFF = 0.8
-- Buffed slightly: the bounce (below) replaces the old instant-recast-on-kill.
function M.sword_throw_percent(level) return pick({ 2.5, 3.0, 3.5, 4.0 }, level) end
M.SWORD_THROW_RANGE = layout.SCREEN_W / 3
M.PUSH_SPEED = 360 -- gentler shove, so ranged enemies aren't knocked out of reach
M.PUSH_RANGE = layout.SCREEN_W / 5
-- How close to a pierced shot's line an enemy must be to be swept up in it.
M.PIERCE_WIDTH = 26

-- Dead Again: resummon a corpse (any melee kill leaves one, tracked but
-- invisible, for a short while) as a weaker, shorter-lived zombie.
M.ZOMBIE_CORPSE_LIFETIME = 10
M.DEAD_AGAIN_RANGE = layout.SCREEN_W / 3
M.DEAD_AGAIN_DURATION = 15

-- The Cure: charm a non-boss mob to your side for a while.
M.CURE_DURATION = 15
M.CURE_RANGE = layout.SCREEN_W / 2.5

-- Monster Zombie: fuse every Dead Again zombie into one, briefly.
M.MONSTER_ZOMBIE_DURATION = 30

-- Drain Life: a channel, planted and interruptible, that saps everyone close.
M.DRAIN_LIFE_DURATION = 10
M.DRAIN_LIFE_RADIUS = 220
function M.drain_life_dps(level) return pick({ 15, 25, 35, 45 }, level) end

-- Stomp: a stun-and-hit around the player.
M.STOMP_RADIUS = 160
M.STOMP_STUN_DURATION = 2
function M.stomp_damage(level) return pick({ 20, 35, 50, 65 }, level) end

function M.ability1_stats(level)
	return { hp = pick({ 50, 100, 150, 200 }, level), damage = 10 * level }
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
		local hps = bracket(function(l) return math.floor(M.ability1_stats(l).hp / 2) end)
		local dmgs = bracket(function(l) return M.ability1_stats(l).damage / 2 end)
		return ("Resummons a nearby corpse (within range, left by any melee kill in the last %ds) as a zombie for %ds. HP %s, DMG %s.")
			:format(M.ZOMBIE_CORPSE_LIFETIME, M.DEAD_AGAIN_DURATION, hps, dmgs)
	elseif skill == "cone" then
		local bases = bracket(M.ability2_base_damage)
		return ("Deals %s flat damage in a widening cone. Auto-aims at the nearest enemy, turning you to face it."):format(bases)
	elseif skill == "ranged" then
		return "Tap to gain +50% attack speed and 50% lifesteal for 5s"
	elseif skill == "fireball" then
		local damage = bracket(M.fireball_attack_damage)
		return ("Enrage all summons for %ds: +50%% attack speed, %s bonus fire damage on every attack, and immunity to expiring.")
			:format(M.FIREBALL_ENRAGE_DURATION, damage)
	elseif skill == "seagull" then
		return ("Charms the nearest non-boss enemy to fight for you for %ds."):format(M.CURE_DURATION)
	elseif skill == "monsterzombie" then
		return ("Fuses every zombie you control into one, combining their current HP and attack damage, for %ds.")
			:format(M.MONSTER_ZOMBIE_DURATION)
	elseif skill == "chainlightning" then
		local hits = bracket(M.chain_lightning_hits)
		local damage = bracket(M.chain_lightning_damage)
		return ("Chains through %s enemies for %s initial damage, reduced by 20%% after each jump. Cast range %d; jump range %d.")
			:format(hits, damage, math.floor(M.CHAIN_LIGHTNING_CAST_RANGE + 0.5), math.floor(M.CHAIN_LIGHTNING_JUMP_RANGE + 0.5))
	elseif skill == "swordthrow" then
		local pcts = bracket(function(l) return math.floor(M.sword_throw_percent(l) * 100 + 0.5) .. "%" end)
		return ("Throws your sword at the nearest enemy for %s attack damage. A kill sends it bouncing straight to another target."):format(pcts)
	elseif skill == "stomp" then
		local damage = bracket(M.stomp_damage)
		return ("Stuns and deals %s damage to every enemy nearby."):format(damage)
	elseif skill == "burn" then
		local damage = bracket(M.burn_explode_damage)
		return ("Hurls a fireball at the nearest enemy that explodes on impact, dealing %s flat damage to nearby enemies."):format(damage)
	elseif skill == "drainlife" then
		local dps = bracket(M.drain_life_dps)
		return ("Channel for %ds, draining %s HP/s from every enemy nearby into yourself. Broken by moving or casting another skill.")
			:format(M.DRAIN_LIFE_DURATION, dps)
	end
	local pcts = bracket(function(l) return math.floor(M.push_damage_percent(l) * 100 + 0.5) .. "%" end)
	return ("Shoves all enemies away from you, dealing %s of your attack damage."):format(pcts)
end

function M.skill_stats_suffix(skill)
	local meta = M.SKILL_META[skill]
	return ("\nCooldown: %ds"):format(meta.cooldown)
end

return M
