-- Run upgrades: the choice of three offered after every cleared boss wave. A
-- pick follows the run to its end; there is no cap on how many stack up. Each
-- kind is a flat effect that stacks additively with itself, and Comboer
-- amplifies the effect of every OTHER upgrade by 10% per Comboer picked.
local M = {}

M.KINDS = { "summoner", "vampire", "spellcaster", "speedrunner", "grinder", "greeder", "comboer" }

-- per: the effect of one pick (a fraction). desc: the tooltip/card line.
M.DEFS = {
	summoner    = { name = "Summoner",    color = { 0.259, 0.647, 0.961 }, per = 0.5, desc = "All summons gain 50% health" },
	vampire     = { name = "Vampire",     color = { 0.898, 0.224, 0.208 }, per = 0.2, desc = "Lifesteal 20% of all damage dealt" },
	spellcaster = { name = "Spellcaster", color = { 0.361, 0.42, 0.753 },  per = 0.3, desc = "Reduce cooldowns by 30%" },
	speedrunner = { name = "Speedrunner", color = { 1.0, 0.792, 0.157 },   per = 0.5, desc = "Increase all attack splash by 50%" },
	grinder     = { name = "Grinder",     color = { 0.612, 0.8, 0.396 },   per = 0.5, desc = "Gain 50% more experience on all skills" },
	greeder     = { name = "Greeder",     color = { 0.992, 0.847, 0.208 }, per = 0.5, desc = "Gain 50% more gold this whole run" },
	comboer     = { name = "Comboer",     color = { 1.0, 0.439, 0.263 },   per = 0.1, desc = "Increase the effect of all other upgrades by 10%" },
}

-- Three distinct kinds drawn for one cleared boss wave.
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
	}
end

return M
