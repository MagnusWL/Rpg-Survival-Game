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
	{ label = "New arena (test)", get = function() return session.bane1_bg end,
		toggle = function() session.bane1_bg = not session.bane1_bg end },
}

function M.build(buttons)
	local o = { rows = {} }
	local row_h = W > H and 36 or 44
	-- One extra row's worth of panel for the Test run button under the list.
	local panel_h = 60 + #ROWS * row_h + 52
	-- Every node here goes on the "overlay" layer so this always draws above
	-- the field/HUD regardless of which was built first -- Defold GUI has no
	-- other way to reorder nodes after the fact, and this panel is built
	-- once in init(), well before most of the gameplay chrome exists yet.
	o.backdrop = ui.overlay(ui.box(W / 2, H / 2, W, H, { 0, 0, 0 }, 0.55))
	-- Reuse the same carved button texture as one large framed settings pane.
	o.panel = ui.overlay(ui.plaque_button(W / 2, H / 2, W - 60, panel_h))
	o.grain = ui.grain(W / 2, H / 2, W - 60, panel_h, 0.16, "overlay")
	o.title = ui.overlay(ui.text(W / 2, H / 2 + panel_h / 2 - 22, "Settings", 16, { 1, 1, 1 }))
	-- Match the skill tree's floating plaque-and-glyph back control.
	o.back = ui.overlay(ui.plaque_button(27, H - 26, 34, 34))
	o.back_icon = ui.overlay(ui.tex_box(27, H - 26, 17, 17, "arrow_up"))
	gui.set_rotation(o.back_icon, vmath.quat_rotation_z(math.rad(90)))
	local top = H / 2 + panel_h / 2 - 54
	for i, row in ipairs(ROWS) do
		local y = top - (i - 1) * row_h
		local label = ui.overlay(ui.text(W / 2 - (W - 100) / 2, y, row.label, 13, { 1, 1, 1 }, gui.PIVOT_W))
		local pill = ui.overlay(ui.plaque_button(W / 2 + (W - 100) / 2 - 24, y, 52, 26))
		local pill_text = ui.overlay(ui.text(W / 2 + (W - 100) / 2 - 24, y, "ON", 11, { 1, 1, 1 }))
		o.rows[i] = { def = row, label = label, pill = pill, pill_text = pill_text }
	end
	-- Development convenience available from the main menu only.
	o.test_btn = ui.overlay(ui.plaque_button(W / 2, top - #ROWS * row_h + 6, 140, 34))
	o.test_text = ui.overlay(ui.text(W / 2, top - #ROWS * row_h + 6, "Get 1000 gold", 12, { 1, 1, 1 }))
	o.exit_btn = ui.overlay(ui.plaque_button(W / 2, top - #ROWS * row_h + 6, 140, 34))
	o.exit_text = ui.overlay(ui.text(W / 2, top - #ROWS * row_h + 6, "Exit run", 12, { 1, 1, 1 }))
	M.hide(o)
	return o
end

local function set_shown(o, on)
	for _, n in ipairs({ o.backdrop, o.panel, o.grain, o.title, o.back, o.back_icon,
		o.test_btn, o.test_text, o.exit_btn, o.exit_text }) do
		gui.set_enabled(n, on)
	end
	for _, r in ipairs(o.rows) do
		gui.set_enabled(r.label, on)
		gui.set_enabled(r.pill, on)
		gui.set_enabled(r.pill_text, on)
	end
end

function M.show(o) set_shown(o, true) end
function M.hide(o) set_shown(o, false) end

function M.sync(o)
	local open = session.overlay == "settings"
	if open then M.show(o) else M.hide(o) end
	if not open then return end
	for _, r in ipairs(o.rows) do
		local on = r.def.get()
		gui.set_text(r.pill_text, on and "ON" or "OFF")
		-- The pill is the bronze plaque texture; these tints multiply onto it,
		-- so a light green keeps the metal readable while still signalling ON,
		-- and a dim desaturated tone reads as OFF.
		gui.set_color(r.pill, on and vmath.vector4(0.65, 1.0, 0.7, 1) or vmath.vector4(0.55, 0.55, 0.6, 1))
	end
	local on_menu = session.screen == "menu"
	gui.set_enabled(o.test_btn, on_menu)
	gui.set_enabled(o.test_text, on_menu)
	gui.set_enabled(o.exit_btn, not on_menu)
	gui.set_enabled(o.exit_text, not on_menu)
end

function M.input(o, action)
	if gui.pick_node(o.back, action.x, action.y) then
		session.overlay = nil
		if session.actions then session.actions.refresh_music() end
		return true
	end
	for _, r in ipairs(o.rows) do
		if gui.pick_node(r.pill, action.x, action.y) or gui.pick_node(r.label, action.x, action.y) then
			r.def.toggle()
			if session.actions then session.actions.refresh_music() end
			return true
		end
	end
	if session.screen == "menu" and gui.pick_node(o.test_btn, action.x, action.y) then
		session.overlay = nil
		if session.actions then session.actions.grant_gold() end
		return true
	end
	if session.screen ~= "menu" and gui.pick_node(o.exit_btn, action.x, action.y) then
		session.overlay = nil
		if session.actions then session.actions.exit_run() end
		return true
	end
	if gui.pick_node(o.panel, action.x, action.y) then return true end
	session.overlay = nil
	if session.actions then session.actions.refresh_music() end
	return true
end

return M
