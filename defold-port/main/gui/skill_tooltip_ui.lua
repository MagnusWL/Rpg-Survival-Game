-- The skill tooltip: label on its own line, then the current rank and its
-- kill/wave xp progress, then the description -- which already carries the
-- per-level stat curve as a bracket (e.g. "(4/8/12/16) damage"), so nothing
-- here repeats it. A small popup anchored just above wherever it was
-- tapped, not a full-screen overlay, sized to the text so there is no
-- leftover whitespace. Shared by the main menu's loadout preview and the
-- skill tree's bottom loadout bar -- each screen builds its own copy of the
-- nodes (a gui scene cannot borrow another screen's).
local layout = require("game.layout")
local skills = require("game.skills")
local ui = require("game.ui")

local M = {}

local W, H = layout.SCREEN_W, layout.SCREEN_H
local PANEL_W = 250
local PAD = 12
local TITLE_SIZE, LEVEL_SIZE, DESC_SIZE = 13, 10, 9
-- Every ui.text scales its node by size/26.7 against the 28px distance-field
-- font; a line's rendered height follows the same ratio, times a generic
-- 1.2 leading factor.
local function line_height(size) return 28 * (size / 26.7) * 1.2 end
local TITLE_H, LEVEL_H, DESC_LINE_H = line_height(TITLE_SIZE), line_height(LEVEL_SIZE), line_height(DESC_SIZE)
local GAP_TITLE_LEVEL, GAP_LEVEL_DESC = 4, 8

-- This Defold build has no text-metrics call, so the wrap width is worked
-- out once here (screen px -> chars, assuming the mono font's ~0.6 advance
-- width) and every description's line count is estimated with the same
-- greedy word-wrap a real layout would do, rather than guessed at.
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
	-- Positioned and sized by show(); built off-screen until then.
	-- Every text node uses PIVOT_NW (top-left): a west-pivoted multi-line
	-- block is vertically CENTRED on its anchor and grows upward as much as
	-- down, which is what overlaps the description into the title above it.
	o.edge = ui.overlay(ui.box(0, -400, PANEL_W + 2, 2, { 1, 0.835, 0.31 }, 0.8))
	o.panel = ui.overlay(ui.box(0, -400, PANEL_W, 1, { 0.08, 0.075, 0.09 }, 0.97))
	o.title = ui.overlay(ui.text(0, -400, "", TITLE_SIZE, { 1, 1, 1 }, gui.PIVOT_NW))
	o.level_line = ui.overlay(ui.text(0, -400, "", LEVEL_SIZE, { 1, 0.835, 0.31 }, gui.PIVOT_NW))
	o.desc = ui.overlay(ui.text(0, -400, "", DESC_SIZE, { 0.82, 0.82, 0.87 }, gui.PIVOT_NW))
	gui.set_line_break(o.desc, true)
	-- gui.set_size's wrap width is in the node's own (unscaled) local space,
	-- but ui.text already scales the node down to render at DESC_SIZE -- so
	-- the box has to be set that much *wider* than the screen-space width we
	-- actually want, or the text wraps at a fraction of the panel's width.
	local desc_scale = DESC_SIZE / 26.7
	gui.set_size(o.desc, vmath.vector3(DESC_WRAP_PX / desc_scale, 2000 / desc_scale, 0))
	M.hide(o)
	return o
end

-- x, y: where the tapped icon sits (gui/world space, y up). The panel is
-- anchored just above that point, sized to fit the description's wrapped
-- line count exactly, and clamped so it never runs off-screen.
-- xp/needed: this skill's current kill/wave-clear progress toward its next
-- rank (needed is nil once it is maxed).
function M.show(o, skill, level, xp, needed, x, y)
	local meta = skills.SKILL_META[skill]
	local desc_text = skills.skill_description(skill)
	gui.set_text(o.title, meta.label .. ":")
	gui.set_text(o.level_line, needed and ("Level %d (%d/%d)"):format(level, xp, needed) or ("Level %d (MAX)"):format(level))
	gui.set_text(o.desc, desc_text)

	local desc_h = wrapped_line_count(desc_text) * DESC_LINE_H
	local panel_h = PAD * 2 + TITLE_H + GAP_TITLE_LEVEL + LEVEL_H + GAP_LEVEL_DESC + desc_h

	local cx = math.max(PANEL_W / 2 + 4, math.min(W - PANEL_W / 2 - 4, x))
	local cy = math.min(H - panel_h / 2 - 4, y + panel_h / 2 + 26)
	local left = cx - PANEL_W / 2 + PAD
	local top = cy + panel_h / 2 - PAD

	gui.set_position(o.panel, vmath.vector3(cx, cy, 0))
	gui.set_size(o.panel, vmath.vector3(PANEL_W, panel_h, 0))
	gui.set_position(o.edge, vmath.vector3(cx, cy, 0))
	gui.set_size(o.edge, vmath.vector3(PANEL_W + 2, panel_h + 2, 0))
	gui.set_position(o.title, vmath.vector3(left, top, 0))
	gui.set_position(o.level_line, vmath.vector3(left, top - TITLE_H - GAP_TITLE_LEVEL, 0))
	gui.set_position(o.desc, vmath.vector3(left, top - TITLE_H - GAP_TITLE_LEVEL - LEVEL_H - GAP_LEVEL_DESC, 0))

	for _, n in ipairs({ o.panel, o.edge, o.title, o.level_line, o.desc }) do gui.set_enabled(n, true) end
	o.open = true
end

function M.hide(o)
	for _, n in ipairs({ o.panel, o.edge, o.title, o.level_line, o.desc }) do gui.set_enabled(n, false) end
	o.open = false
end

-- Any tap while open dismisses it; the caller checks o.open first so its
-- own buttons underneath don't also react to that same tap.
function M.input(o, action)
	if not o.open then return false end
	M.hide(o)
	return true
end

return M
