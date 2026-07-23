-- Persistent equipment, deliberately independent from the retired bag/item code.
-- A character owns exactly one equipped item per RPG slot; chest offers are
-- compared directly against that slot and are never stored in a loose bag.
local M = {}

M.SLOTS = { "weapon", "helmet", "chest", "gloves", "boots", "charm" }
M.SLOT_LABELS = {
	weapon = "Weapon", helmet = "Helmet", chest = "Armor",
	gloves = "Gloves", boots = "Boots", charm = "Charm",
}

local BASES = {
	weapon = {
		{ name = "Gravecleaver", stats = { attack_damage = 3, ability_power = 0.02 } },
		{ name = "Hexblade", stats = { attack_damage = 2, cooldown = 0.015 } },
	},
	helmet = {
		{ name = "Seer's Helm", stats = { ability_power = 0.04, max_health = 4 } },
		{ name = "War Crown", stats = { attack_speed = 0.025, max_health = 5 } },
	},
	chest = {
		{ name = "Bastion Plate", stats = { max_health = 14, health_regen = 0.12 } },
		{ name = "Bloodmail", stats = { max_health = 10, lifesteal = 0.008 } },
	},
	gloves = {
		{ name = "Ravager Grips", stats = { attack_speed = 0.045, attack_damage = 1 } },
		{ name = "Runespun Gloves", stats = { cooldown = 0.025, ability_power = 0.02 } },
	},
	boots = {
		{ name = "Windstriders", stats = { move_speed = 4, attack_speed = 0.02 } },
		{ name = "Pilgrim Greaves", stats = { move_speed = 3, health_regen = 0.10 } },
	},
	charm = {
		{ name = "Ancestor Idol", stats = { summon_health = 0.06, ability_power = 0.02 } },
		{ name = "Vampire Fang", stats = { lifesteal = 0.012, cooldown = 0.01 } },
	},
}

M.STAT_ORDER = { "max_health", "health_regen", "attack_damage", "attack_speed",
	"ability_power", "cooldown", "lifesteal", "move_speed", "summon_health" }
M.STAT_LABELS = {
	max_health = "Max health", health_regen = "Health regen", attack_damage = "Attack damage",
	attack_speed = "Attack speed", ability_power = "Ability power", cooldown = "Cooldown reduction",
	lifesteal = "Lifesteal", move_speed = "Movement speed", summon_health = "Summon health",
}
local PERCENT = { attack_speed = true, ability_power = true, cooldown = true, lifesteal = true, summon_health = true }

function M.item_level(waves_cleared)
	return math.max(1, math.floor((waves_cleared or 0) / 5))
end

function M.roll(level)
	level = math.max(1, math.floor(level or 1))
	local slot = M.SLOTS[math.random(#M.SLOTS)]
	local base = BASES[slot][math.random(#BASES[slot])]
	local stats = {}
	for stat, per_level in pairs(base.stats) do stats[stat] = per_level * level end
	return { id = ("%d-%d-%d"):format(os.time(), math.random(999999), level), slot = slot,
		name = base.name, level = level, stats = stats }
end

function M.sanitize_equipment(raw)
	local out = {}
	for _, slot in ipairs(M.SLOTS) do
		local item = raw and raw[slot]
		if type(item) == "table" and item.slot == slot and type(item.stats) == "table" then
			out[slot] = item
		end
	end
	return out
end

function M.bonuses(equipment)
	local result = {}
	for _, stat in ipairs(M.STAT_ORDER) do result[stat] = 0 end
	for _, item in pairs(equipment or {}) do
		for stat, value in pairs(item.stats or {}) do
			if result[stat] ~= nil then result[stat] = result[stat] + value end
		end
	end
	return result
end

function M.stat_text(stat, value, signed)
	local prefix = signed and (value >= 0 and "+" or "") or ""
	local function round(v) return v >= 0 and math.floor(v + 0.5) or math.ceil(v - 0.5) end
	if PERCENT[stat] then return prefix .. tostring(round(value * 100)) .. "%" end
	if stat == "health_regen" then return prefix .. ("%.1f/sec"):format(value) end
	return prefix .. tostring(round(value))
end

function M.describe(item)
	if not item then return {} end
	local lines = {}
	for _, stat in ipairs(M.STAT_ORDER) do
		local value = item.stats[stat]
		if value and value ~= 0 then lines[#lines + 1] = M.STAT_LABELS[stat] .. "  " .. M.stat_text(stat, value, true) end
	end
	return lines
end

return M
