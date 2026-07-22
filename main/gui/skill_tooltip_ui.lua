-- The skill tooltip: label, the current rank (or "Locked"), the description,
-- and -- in the skill tree -- an action button to Unlock or Equip the skill.
-- A small popup anchored just above the skill icon, sized to its
-- contents. Shared by the main menu's loadout preview (read-only, no button)
-- and the skill tree's pods and loadout bar. Each screen builds its own copy
-- of the nodes (a gui scene cannot borrow another screen's).
local layout = require("game.layout")
local skills = require("game.skills")
local ui = require("game.ui")

local M = {}

local W, H = layout.SCREEN_W, layout.SCREEN_H
local PANEL_W = 250
local PAD = 12
local TITLE_SIZE, LEVEL_SIZE, DESC_SIZE = 13, 10, 9
local function line_height(size) return 28 * (size / 26.7) * 1.2 end
local TITLE_H, LEVEL_H, DESC_LINE_H = line_height(TITLE_SIZE), line_height(LEVEL_SIZE), line_height(DESC_SIZE)
local GAP_TITLE_LEVEL, GAP_LEVEL_DESC = 4, 8
local BTN_H, GAP_DESC_BTN = 28, 10

local DESC_WRAP_PX = PANEL_W - PAD * 2
local CHARS_PER_LINE = math.max(8, math.floor(DESC_WRAP_PX / (28 * (DESC_SIZE / 26.7) * 0.6)))

local function wrapped_line_count(text)
	local lines, col = 1, 0
	for word in text:gmatch("%S+") do
		local wlen = #word
		if col == 0 then
			col = wlen
		elseif col + 1 + wlen <= CHARS_PER_LINE then
			col = col + 1 + wlen
		else
			lines = lines + 1
			col = wlen
		end
	end
	return lines
end

function M.build()
	local o = {}
	o.edge = ui.overlay(ui.box(0, -400, PANEL_W + 2, 2, { 1, 0.835, 0.31 }, 0.8))
	o.panel = ui.overlay(ui.box(0, -400, PANEL_W, 1, { 0.08, 0.075, 0.09 }, 0.97))
	o.title = ui.overlay(ui.text(0, -400, "", TITLE_SIZE, { 1, 1, 1 }, gui.PIVOT_NW))
	o.level_line = ui.overlay(ui.text(0, -400, "", LEVEL_SIZE, { 1, 0.835, 0.31 }, gui.PIVOT_NW))
	o.desc = ui.overlay(ui.text(0, -400, "", DESC_SIZE, { 0.82, 0.82, 0.87 }, gui.PIVOT_NW))
	gui.set_line_break(o.desc, true)
	local desc_scale = DESC_SIZE / 26.7
	gui.set_size(o.desc, vmath.vector3(DESC_WRAP_PX / desc_scale, 2000 / desc_scale, 0))
	-- The Unlock/Equip button, hidden unless show() is given an action.
	o.action_btn = ui.overlay(ui.plaque_button(0, -400, PANEL_W - PAD * 2, BTN_H))
	o.action_text = ui.overlay(ui.text(0, -400, "", 11, { 0.965, 0.86, 0.6 }))
	M.hide(o)
	return o
end

-- opts (optional, skill tree only): { locked, cost, can_afford, equipped,
-- equip_slot, anchor_gap, on_action }. on_action(kind) is called with
-- "unlock" | "equip" | "unequip".
function M.show(o, skill, level, xp, needed, x, y, opts)
	opts = opts or {}
	local meta = skills.SKILL_META[skill]
	local desc_text = skills.skill_description(skill)
	gui.set_text(o.title, meta.label .. ":")
	if opts.locked then
		gui.set_text(o.level_line, "Locked")
	else
		gui.set_text(o.level_line, needed
			and ("Rank %s (%d/%d)"):format(skills.rank_roman(level), xp, needed)
			or ("Rank %s (MAX)"):format(skills.rank_roman(level)))
	end
	gui.set_text(o.desc, desc_text)

	-- Which action button (if any) applies to this skill right now.
	local kind, label = nil, nil
	if opts.locked then
		kind, label = "unlock", ("Unlock skill (%dg)"):format(opts.cost or 0)
	elseif opts.equipped then
		kind, label = "unequip", "Unequip"
	elseif opts.equip_slot then
		kind, label = "equip", ("Equip (Slot %d)"):format(opts.equip_slot)
	end
	o.action_kind = kind
	o.action_enabled = kind ~= "unlock" or opts.can_afford ~= false
	o.on_action = opts.on_action

	local desc_h = wrapped_line_count(desc_text) * DESC_LINE_H
	local btn_block = kind and (GAP_DESC_BTN + BTN_H) or 0
	local panel_h = PAD * 2 + TITLE_H + GAP_TITLE_LEVEL + LEVEL_H + GAP_LEVEL_DESC + desc_h + btn_block

	local cx = math.max(PANEL_W / 2 + 4, math.min(W - PANEL_W / 2 - 4, x))
	local cy = math.min(H - panel_h / 2 - 4, y + panel_h / 2 + (opts.anchor_gap or 26))
	local left = cx - PANEL_W / 2 + PAD
	local top = cy + panel_h / 2 - PAD

	gui.set_position(o.panel, vmath.vector3(cx, cy, 0))
	gui.set_size(o.panel, vmath.vector3(PANEL_W, panel_h, 0))
	gui.set_position(o.edge, vmath.vector3(cx, cy, 0))
	gui.set_size(o.edge, vmath.vector3(PANEL_W + 2, panel_h + 2, 0))
	gui.set_position(o.title, vmath.vector3(left, top, 0))
	gui.set_position(o.level_line, vmath.vector3(left, top - TITLE_H - GAP_TITLE_LEVEL, 0))
	local desc_top = top - TITLE_H - GAP_TITLE_LEVEL - LEVEL_H - GAP_LEVEL_DESC
	gui.set_position(o.desc, vmath.vector3(left, desc_top, 0))

	local base = { o.panel, o.edge, o.title, o.level_line, o.desc }
	for _, n in ipairs(base) do gui.set_enabled(n, true) end
	if kind then
		local by = desc_top - desc_h - GAP_DESC_BTN - BTN_H / 2
		gui.set_position(o.action_btn, vmath.vector3(cx, by, 0))
		gui.set_position(o.action_text, vmath.vector3(cx, by, 0))
		gui.set_text(o.action_text, label)
		if o.action_enabled then
			gui.set_color(o.action_btn, vmath.vector4(1, 1, 1, 1))
			gui.set_color(o.action_text, vmath.vector4(0.965, 0.86, 0.6, 1))
		else
			gui.set_color(o.action_btn, vmath.vector4(0.35, 0.35, 0.35, 1))
			gui.set_color(o.action_text, vmath.vector4(0.55, 0.55, 0.55, 1))
		end
		gui.set_enabled(o.action_btn, true)
		gui.set_enabled(o.action_text, true)
	else
		gui.set_enabled(o.action_btn, false)
		gui.set_enabled(o.action_text, false)
	end
	o.open = true
end

function M.hide(o)
	for _, n in ipairs({ o.panel, o.edge, o.title, o.level_line, o.desc, o.action_btn, o.action_text }) do
		gui.set_enabled(n, false)
	end
	o.open = false
	o.action_kind = nil
	o.action_enabled = false
end

-- A tap on the action button fires its action; any other tap dismisses. Screen
-- input handlers call this before their controls so nothing beneath reacts.
function M.input(o, action)
	if not o.open then return false end
	if o.action_kind and o.action_enabled and gui.is_enabled(o.action_btn) and gui.pick_node(o.action_btn, action.x, action.y) then
		local kind, cb = o.action_kind, o.on_action
		M.hide(o)
		if cb then cb(kind) end
		return true
	end
	M.hide(o)
	return true
end

return M
