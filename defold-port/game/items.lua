-- Item definitions and loot, ported from items.ts.
local layout = require("game.layout")

local M = {}

M.ITEM_DEFS = {
	dmg = { name = "Blade", color = { 1.0, 0.439, 0.263 }, per_level = 2,
		format = function(t) return string.format("+%d damage", t) end },
	atkspd = { name = "Gloves", color = { 1.0, 0.792, 0.157 }, per_level = 0.03,
		format = function(t) return string.format("+%d%% attack speed", math.floor(t * 100 + 0.5)) end },
	mana = { name = "Crystal", color = { 0.259, 0.647, 0.961 }, per_level = 6,
		format = function(t) return string.format("+%d max mana", t) end },
	manaregen = { name = "Sigil", color = { 0.149, 0.776, 0.855 }, per_level = 1,
		format = function(t) return string.format("+%d mana regen/s", t) end },
	health = { name = "Armor", color = { 0.4, 0.733, 0.416 }, per_level = 8,
		format = function(t) return string.format("+%d max health", t) end },
	healthregen = { name = "Amulet", color = { 0.612, 0.8, 0.396 }, per_level = 1,
		format = function(t) return string.format("+%d health regen/s", t) end },
}
M.ITEM_KINDS = { "dmg", "atkspd", "mana", "manaregen", "health", "healthregen" }

M.EQUIP_SLOTS = 3
M.BAG_SLOTS = 9
M.ITEM_SIZE = 24
M.ITEM_DESPAWN = 10.0 -- seconds
M.ITEM_PICKUP_RADIUS = 18 + 14 -- PLAYER_RADIUS + 14
M.INV_DRAG_THRESHOLD = 14

function M.item_bonus(item)
	return M.ITEM_DEFS[item.kind].per_level * item.level
end

function M.item_tooltip(item)
	local def = M.ITEM_DEFS[item.kind]
	local total = math.floor(M.item_bonus(item) * 100 + 0.5) / 100
	return string.format("%s · iLvl %d\n%s", def.name, item.level, def.format(total))
end

local item_id_counter = 0

function M.make_item(kind, level)
	item_id_counter = item_id_counter + 1
	return { id = item_id_counter, kind = kind, level = level }
end

function M.spawn_loot(wave, now)
	local level = math.max(1, wave + (math.random(0, 4) - 2))
	local kind = M.ITEM_KINDS[math.random(#M.ITEM_KINDS)]
	local margin = 30
	return {
		item = M.make_item(kind, level),
		pos = {
			x = margin + math.random() * (layout.SCREEN_W - margin * 2),
			y = margin + math.random() * (layout.PLAY_H - margin * 2),
		},
		created_at = now,
	}
end

-- equipped is an array of EQUIP_SLOTS entries, false for an empty slot (Lua
-- arrays cannot hold nil without breaking length).
function M.equipped_bonus(equipped, kind)
	local total = 0
	for _, it in ipairs(equipped) do
		if it and it.kind == kind then total = total + M.item_bonus(it) end
	end
	return total
end

return M
