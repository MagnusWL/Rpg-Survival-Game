-- Run upgrades: the choice of three offered after every cleared wave. A pick
-- follows the run to its end; there is no cap on how many stack up. These
-- replace the old ground-item drops (mana kinds removed with the mana bar)
-- and the tree's three passive skills, folded in here as stackable picks.
local M = {}

M.KINDS = { "dmg", "atkspd", "health", "healthregen", "haste", "summonregen", "pierce" }

M.DEFS = {
	dmg = { name = "Blade", color = { 1.0, 0.439, 0.263 }, per_tier = 2,
		format = function(t) return string.format("+%d damage", t) end },
	atkspd = { name = "Gloves", color = { 1.0, 0.792, 0.157 }, per_tier = 0.03,
		format = function(t) return string.format("+%d%% attack speed", math.floor(t * 100 + 0.5)) end },
	health = { name = "Armor", color = { 0.4, 0.733, 0.416 }, per_tier = 8,
		format = function(t) return string.format("+%d max health", t) end },
	healthregen = { name = "Amulet", color = { 0.612, 0.8, 0.396 }, per_tier = 1,
		format = function(t) return string.format("+%d health regen/s", t) end },
	-- The tree's former passives: Haste, Summon Regen and Pierce, now picked
	-- up in the field like any other upgrade instead of bought and equipped.
	haste = { name = "Hourglass", color = { 0.898, 0.224, 0.208 }, per_tier = 0.05,
		format = function(t) return string.format("-%d%% skill cooldowns", math.floor(t * 100 + 0.5)) end },
	summonregen = { name = "Effigy", color = { 0.259, 0.647, 0.961 }, per_tier = 2,
		format = function(t) return string.format("+%d summon health regen/s", t) end },
	pierce = { name = "Quiver", color = { 0.992, 0.847, 0.208 }, per_tier = 1,
		format = function(t) return string.format("shots pierce +%d enemies", math.floor(t + 0.5)) end },
}

-- The offer's tier follows the wave the way item levels did: the wave give
-- or take a couple, never below 1.
local function roll_tier(wave)
	return math.max(1, wave + math.random(0, 4) - 2)
end

-- Three distinct kinds drawn for one cleared wave.
function M.roll_offers(wave)
	local pool = { unpack(M.KINDS) }
	local offers = {}
	for _ = 1, 3 do
		local i = math.random(#pool)
		local kind = table.remove(pool, i)
		offers[#offers + 1] = { kind = kind, tier = roll_tier(wave) }
	end
	return offers
end

function M.value(up)
	return M.DEFS[up.kind].per_tier * up.tier
end

function M.describe(up)
	local def = M.DEFS[up.kind]
	return def.name .. " " .. def.format(M.value(up))
end

-- Summed bonuses over everything picked this run.
function M.bonuses(upgrades)
	local t = { dmg = 0, atkspd = 0, health = 0, healthregen = 0, haste = 0, summonregen = 0, pierce = 0 }
	for _, up in ipairs(upgrades) do
		t[up.kind] = t[up.kind] + M.value(up)
	end
	return t
end

return M
