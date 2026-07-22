-- The one skill-icon design, reused everywhere a skill or upgrade's face
-- appears: a dark disc, a coloured ring border, and the icon centred on
-- top. Used by the main menu's loadout preview, the skill tree's pods and
-- its bottom loadout bar, the in-game quick-cast buttons (all orange, the
-- "equipped" colour), and the Upgrades screen (light blue, so an upgrade
-- reads as its own kind of thing at a glance) -- one look, one place it is
-- defined.
local ui = require("game.ui")

local M = {}

M.GLOW = { 0.941, 0.722, 0.251 } -- the equipped/orange rim
M.LIGHT_BLUE = { 0.482, 0.741, 0.914 } -- the upgrade rim
M.DIM_RIM = { 0.271, 0.239, 0.200 } -- rim when nothing is equipped there
M.DISC = { 0.055, 0.047, 0.031 } -- the disc every icon sits on

-- size: outer diameter (the ring); icon_px: the icon's own square size.
-- rim_color defaults to the orange "equipped" tone; pass M.LIGHT_BLUE for
-- an upgrade's icon. Returns {rim=, disc=, icon=}, each independently
-- enable-able; the icon node uses the shared "skilltree" atlas, so callers
-- just gui.play_flipbook the animation they want onto it.
function M.build(x, y, size, icon_px, anim, rim_color)
	local rim = ui.tex_box(x, y, size, size, "ring")
	local disc = ui.tex_box(x, y, size - 5, size - 5, "circle")
	gui.set_color(disc, vmath.vector4(M.DISC[1], M.DISC[2], M.DISC[3], 1))
	local c = rim_color or M.GLOW
	gui.set_color(rim, vmath.vector4(c[1], c[2], c[3], 1))
	local icon = gui.new_box_node(vmath.vector3(x, y, 0), vmath.vector3(icon_px, icon_px, 0))
	gui.set_texture(icon, "skilltree")
	if anim then gui.play_flipbook(icon, anim) end
	return { rim = rim, disc = disc, icon = icon }
end

-- Colours the rim orange (equipped/filled) or the dim resting tone (empty).
function M.set_lit(handle, lit)
	local c = lit and M.GLOW or M.DIM_RIM
	gui.set_color(handle.rim, vmath.vector4(c[1], c[2], c[3], 1))
end

function M.set_enabled(handle, on)
	for _, n in ipairs({ handle.rim, handle.disc, handle.icon }) do gui.set_enabled(n, on) end
end

function M.set_alpha(handle, a)
	for _, n in ipairs({ handle.rim, handle.disc, handle.icon }) do ui.set_alpha(n, a) end
end

return M
