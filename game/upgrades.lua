-- Run upgrades: every route-map node carries one. Choosing the next connected
-- map grants its upgrade for the rest of the run. There is no stack cap. Each
-- kind is a flat effect that stacks additively with itself, and Comboer
-- amplifies the effect of every OTHER upgrade by 10% per Comboer picked.
local M = {}

M.KINDS = { "summoner", "vampire", "spellcaster", "speedrunner", "grinder", "greeder", "comboer",
	"abilitypower", "attackdamage", "attackspeed" }

-- per: the effect of one pick (a fraction). desc: the tooltip/card line.
M.DEFS = {
	summoner    = { name = "Summoner",    color = { 0.259, 0.647, 0.961 }, per = 0.5, desc = "All summons gain 50% health" },
	vampire     = { name = "Vampire",     color = { 0.898, 0.224, 0.208 }, per = 0.2, desc = "Lifesteal 20% of all damage dealt" },
	spellcaster = { name = "Spellcaster", color = { 0.361, 0.42, 0.753 },  per = 0.3, desc = "Reduce cooldowns by 30%" },
	speedrunner = { name = "Speedrunner", color = { 1.0, 0.792, 0.157 },   per = 0.5, desc = "Increase all attack splash by 50%" },
	grinder     = { name = "Grinder",     color = { 0.612, 0.8, 0.396 },   per = 0.5, desc = "Gain 50% more experience on all skills" },
	greeder     = { name = "Greeder",     color = { 0.992, 0.847, 0.208 }, per = 0.5, desc = "Gain 50% more gold this whole run" },
	comboer     = { name = "Comboer",     color = { 1.0, 0.439, 0.263 },   per = 0.1, desc = "Increase the effect of all other upgrades by 10%" },
	abilitypower= { name = "Ability Power",color = { 0.55, 0.45, 1.0 },     per = 0.25, desc = "Increase all ability damage by 25%" },
	attackdamage= { name = "Might",        color = { 0.9, 0.35, 0.25 },     per = 5, desc = "Increase attack damage by 5" },
	attackspeed = { name = "Frenzy",       color = { 1.0, 0.75, 0.2 },      per = 0.2, desc = "Increase attack speed by 20%" },
}

-- Three distinct kinds used across one row of the route grid.
function M.roll_offers(wave)
	local pool = { unpack(M.KINDS) }
	local offers = {}
	for _ = 1, 3 do
		local i = math.random(#pool)
		offers[#offers + 1] = { kind = table.remove(pool, i) }
	end
	return offers
end

-- The card/list line: the effect text (the name is carried by the icon).
function M.describe(up)
	return M.DEFS[up.kind].desc
end

-- Summed, Comboer-amplified effects over everything picked this run. Every
-- value is a fraction to scale by: e.g. summon_health 1.0 means +100% health.
function M.bonuses(upgrades)
	local count = {}
	for _, k in ipairs(M.KINDS) do count[k] = 0 end
	for _, up in ipairs(upgrades) do count[up.kind] = (count[up.kind] or 0) + 1 end
	-- Comboer lifts every OTHER upgrade; it never amplifies itself.
	local combo = count.comboer * M.DEFS.comboer.per
	local mult = 1 + combo
	local function amt(kind) return count[kind] * M.DEFS[kind].per * mult end
	return {
		summon_health = amt("summoner"),
		lifesteal     = amt("vampire"),
		cooldown      = amt("spellcaster"),
		splash        = amt("speedrunner"),
		xp            = amt("grinder"),
		gold          = amt("greeder"),
		combo         = combo,
		ability_power = amt("abilitypower"),
		attack_damage = amt("attackdamage"),
		attack_speed  = amt("attackspeed"),
	}
end

return M
