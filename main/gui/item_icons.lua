-- Atlas animation ids for equipped and empty equipment-slot art.
local M = {}

for _, slot in ipairs({ "weapon", "helmet", "chest", "gloves", "boots", "charm" }) do
	M[slot] = "item_" .. slot
	M[slot .. "_empty"] = "item_" .. slot .. "_empty"
end

function M.for_slot(slot, filled)
	return M[slot .. (filled and "" or "_empty")]
end

return M
