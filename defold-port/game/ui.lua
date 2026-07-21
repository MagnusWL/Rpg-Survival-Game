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

function M.text(x, y, str, size, color, pivot)
	local n = gui.new_text_node(vmath.vector3(x, y, 0), str)
	gui.set_font(n, "default_font")
	gui.set_scale(n, vmath.vector3(size / 32, size / 32, 1))
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

return M
