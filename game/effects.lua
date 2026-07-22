-- Ground/weather geometry ported from effects.tsx: the background's cover
-- fit, puddle lookup for wet footsteps, and the rain/ripple tuning numbers.
local layout = require("game.layout")

local M = {}

M.PUDDLE_SPOTS = require("game.puddles")

M.BG_SOURCE_H = 1086
M.BG_ASPECT = 1448 / M.BG_SOURCE_H

-- The same 'cover' the background is drawn with: scale until it fills,
-- centre the overflow.
M.bg_drawn_w = math.max(layout.SCREEN_W, layout.PLAY_H * M.BG_ASPECT)
M.bg_drawn_h = math.max(layout.PLAY_H, layout.SCREEN_W / M.BG_ASPECT)
M.bg_offset_x = (layout.SCREEN_W - M.bg_drawn_w) / 2
M.bg_offset_y = (layout.PLAY_H - M.bg_drawn_h) / 2

function M.on_ground_x(fx) return M.bg_offset_x + fx * M.bg_drawn_w end
function M.on_ground_y(fy) return M.bg_offset_y + fy * M.bg_drawn_h end

M.ground_scale = M.bg_drawn_h / M.BG_SOURCE_H

-- Whether someone standing here has their feet in water. Squashed by half
-- vertically, because the ground is seen at an angle.
function M.feet_in_water(pos)
	for _, spot in ipairs(M.PUDDLE_SPOTS) do
		local dx = pos.x - M.on_ground_x(spot[1])
		local dy = (pos.y - M.on_ground_y(spot[2])) * 2
		local r = spot[3] * M.ground_scale
		if dx * dx + dy * dy < r * r then return true end
	end
	return false
end

M.RAIN = {
	drops = 230,
	tilt_deg = 2,
	speed_far = 60,
	speed_near = 200,
	length_far = 1,
	length_near = 9,
	opacity_far = 0.14,
	opacity_near = 0.26,
	color = { 0.745, 0.839, 0.922 },
	step_fps = 15,
}
M.RAIN_TILT_X = math.tan(math.rad(M.RAIN.tilt_deg))
M.RAIN_DRIFT = layout.PLAY_H * M.RAIN_TILT_X
M.RAIN_SPAN = layout.PLAY_H + M.RAIN.length_near

M.RIPPLE = {
	slots = 10,
	size = 19,
	period_fast = 1.5,
	period_slow = 3.7,
	opacity = 0.73,
	color = { 0.784, 0.878, 0.961 },
	steps = 8,
}

-- Repeatable stand-in for randomness, so a ripple needs no state to remember.
function M.noise(n)
	local x = math.sin(n * 12.9898) * 43758.5453
	return x - math.floor(x)
end

-- Fixed for the life of the app: the depth each drop was dealt.
M.RAIN_STREAKS = {}
for _ = 1, M.RAIN.drops do
	local near = math.random()
	M.RAIN_STREAKS[#M.RAIN_STREAKS + 1] = {
		x = math.random(),
		speed = M.RAIN.speed_far + near * (M.RAIN.speed_near - M.RAIN.speed_far),
		length = M.RAIN.length_far + near * (M.RAIN.length_near - M.RAIN.length_far),
		width = near > 1 and 2 or 1,
		opacity = M.RAIN.opacity_far + near * (M.RAIN.opacity_near - M.RAIN.opacity_far),
		offset = math.random(),
	}
end

-- One ripple slot per visible patch of water, banded across the screen so the
-- few rings spread over all of it (the same thinning the React version does).
local RIPPLE_CELL = 24
local pool
do
	local cells, order = {}, {}
	for _, spot in ipairs(M.PUDDLE_SPOTS) do
		local x = M.on_ground_x(spot[1])
		local y = M.on_ground_y(spot[2])
		if x >= 0 and x <= layout.SCREEN_W and y >= 0 and y <= layout.PLAY_H then
			local key = math.floor(x / RIPPLE_CELL + 0.5) .. "," .. math.floor(y / RIPPLE_CELL + 0.5)
			if not cells[key] then
				cells[key] = spot
				order[#order + 1] = spot
			end
		end
	end
	pool = #order > 0 and order or M.PUDDLE_SPOTS
	table.sort(pool, function(a, b) return M.on_ground_x(a[1]) < M.on_ground_x(b[1]) end)
end
M.RIPPLE_POOL = pool

M.RIPPLES = {}
for i = 0, M.RIPPLE.slots - 1 do
	local seed = i * 37 + 11
	local idx = math.floor(((i + M.noise(seed)) / M.RIPPLE.slots) * #M.RIPPLE_POOL)
	local spot = M.RIPPLE_POOL[math.min(idx + 1, #M.RIPPLE_POOL)]
	M.RIPPLES[#M.RIPPLES + 1] = {
		spot = spot,
		period = M.RIPPLE.period_fast + M.noise(i * 3.1) * (M.RIPPLE.period_slow - M.RIPPLE.period_fast),
		phase = M.noise(i * 7.7),
	}
end

return M
