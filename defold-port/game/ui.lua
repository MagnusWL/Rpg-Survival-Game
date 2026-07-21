-- Small helpers for building GUI nodes in code. Every screen builds its nodes
-- dynamically, so these keep the gui_scripts terse.
local M = {}

function M.box(x, y, w, h, color, alpha)
	local n = gui.new_box_node(vmath.vector3(x, y, 0), vmath.vector3(w, h, 0))
	gui.set_color(n, vmath.vector4(color[1], color[2], color[3], alpha or 1))
	return n
end

function M.tex_box(x, y, w, h, tex)
	local n = gui.new_box_node(vmath.vector3(x, y, 0), vmath.vector3(w, h, 0))
	gui.set_texture(n, "ui")
	gui.play_flipbook(n, tex)
	return n
end

-- The carved-frame button look (btn_steel/btn_gold/btn_red/btn_blue), sliced
-- so its bevel/rivet border stays a fixed pixel width and only the flat
-- centre stretches -- these buttons come in many different sizes (a 30px
-- gear button, a 140px "Main Menu" button) and a plain stretched box would
-- smear the corner bevels at the small end.
function M.button_frame(x, y, w, h, tex)
	local n = M.tex_box(x, y, w, h, tex)
	gui.set_slice9(n, vmath.vector4(10, 10, 10, 10))
	return n
end

function M.text(x, y, str, size, color, pivot)
	local n = gui.new_text_node(vmath.vector3(x, y, 0), str)
	gui.set_font(n, "default_font")
	-- The font is a 28px distance field; size/26.7 renders callers' sizes at
	-- 1.2x the original scale -- settled by eye, stepped down from a straight
	-- doubling that read far too big.
	gui.set_scale(n, vmath.vector3(size / 26.7, size / 26.7, 1))
	gui.set_color(n, vmath.vector4(color[1], color[2], color[3], 1))
	gui.set_pivot(n, pivot or gui.PIVOT_CENTER)
	return n
end

function M.inside(node, x, y)
	return gui.pick_node(node, x, y)
end

-- Register a tappable region; returns the node for later hit tests.
function M.button(list, node, handler)
	list[#list + 1] = { node = node, handler = handler }
	return node
end

function M.hit(list, x, y)
	for i = #list, 1, -1 do
		local b = list[i]
		if gui.is_enabled(b.node, true) and gui.pick_node(b.node, x, y) then
			b.handler()
			return true
		end
	end
	return false
end

function M.set_alpha(node, a)
	local c = gui.get_color(node)
	c.w = a
	gui.set_color(node, c)
end

-- Pins a node to the "overlay" layer (declared in every .gui this ships
-- with), which always draws above the "base" layer regardless of which was
-- created first. Node creation order in code otherwise decides draw order,
-- which is why a settings panel built early in init() could end up drawn
-- under HUD/field elements created later -- layers make that independent of
-- when a node happens to be built.
function M.overlay(node)
	gui.set_layer(node, "overlay")
	return node
end

-- A faint stone/parchment grain, stretched over a solid panel to give it
-- some texture instead of a flat colour -- the same grain the skill tree's
-- own backdrop is built from. Draw it directly on top of the panel it
-- belongs to (same x/y/w/h), after that panel's own box node.
function M.grain(x, y, w, h, alpha)
	local n = M.tex_box(x, y, w, h, "panel_tex")
	M.set_alpha(n, alpha or 0.22)
	return n
end

return M
