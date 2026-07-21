-- The settings overlay, shared by the menu and the game screen: every sound/
-- weather toggle plus the technical readout switch, one list behind the gear.
local layout = require("game.layout")
local session = require("game.session")
local ui = require("game.ui")

local M = {}

local W, H = layout.SCREEN_W, layout.SCREEN_H

local ROWS = {
	{ label = "Sound", get = function() return not session.all_sound_off end,
		toggle = function() session.all_sound_off = not session.all_sound_off end },
	{ label = "Sound effects", get = function() return not session.sfx_off end,
		toggle = function() session.sfx_off = not session.sfx_off end },
	{ label = "Music", get = function() return not session.music_off end,
		toggle = function() session.music_off = not session.music_off end },
	{ label = "Weather", get = function() return not session.weather_off end,
		toggle = function() session.weather_off = not session.weather_off end },
	{ label = "Technical info", get = function() return session.tech_on end,
		toggle = function() session.tech_on = not session.tech_on end },
}

function M.build(buttons)
	local o = { rows = {} }
	o.backdrop = ui.box(W / 2, H / 2, W, H, { 0, 0, 0 }, 0.55)
	o.panel = ui.box(W / 2, H / 2, W - 60, 60 + #ROWS * 44, { 0.1, 0.1, 0.18 }, 1)
	o.title = ui.text(W / 2, H / 2 + (#ROWS * 44) / 2 + 8, "Settings", 16, { 1, 1, 1 })
	local top = H / 2 + (#ROWS * 44) / 2 - 24
	for i, row in ipairs(ROWS) do
		local y = top - (i - 1) * 44
		local label = ui.text(W / 2 - (W - 100) / 2, y, row.label, 13, { 1, 1, 1 }, gui.PIVOT_W)
		local pill = ui.box(W / 2 + (W - 100) / 2 - 24, y, 48, 24, { 0.298, 0.686, 0.314 }, 1)
		local pill_text = ui.text(W / 2 + (W - 100) / 2 - 24, y, "ON", 11, { 1, 1, 1 })
		o.rows[i] = { def = row, label = label, pill = pill, pill_text = pill_text }
	end
	M.hide(o)
	return o
end

function M.show(o)
	for _, n in ipairs({ o.backdrop, o.panel, o.title }) do gui.set_enabled(n, true) end
	for _, r in ipairs(o.rows) do
		gui.set_enabled(r.label, true)
		gui.set_enabled(r.pill, true)
		gui.set_enabled(r.pill_text, true)
	end
end

function M.hide(o)
	for _, n in ipairs({ o.backdrop, o.panel, o.title }) do gui.set_enabled(n, false) end
	for _, r in ipairs(o.rows) do
		gui.set_enabled(r.label, false)
		gui.set_enabled(r.pill, false)
		gui.set_enabled(r.pill_text, false)
	end
end

function M.sync(o)
	local open = session.overlay == "settings"
	if open then M.show(o) else M.hide(o) end
	if not open then return end
	for _, r in ipairs(o.rows) do
		local on = r.def.get()
		gui.set_text(r.pill_text, on and "ON" or "OFF")
		gui.set_color(r.pill, on and vmath.vector4(0.298, 0.686, 0.314, 1) or vmath.vector4(0.4, 0.4, 0.45, 1))
	end
end

function M.input(o, action)
	for _, r in ipairs(o.rows) do
		if gui.pick_node(r.pill, action.x, action.y) or gui.pick_node(r.label, action.x, action.y) then
			r.def.toggle()
			if session.actions then session.actions.refresh_music() end
			return true
		end
	end
	if gui.pick_node(o.panel, action.x, action.y) then return true end
	session.overlay = nil
	if session.actions then session.actions.refresh_music() end
	return true
end

return M
