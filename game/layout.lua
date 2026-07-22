-- Screen layout. The React app derived these from the window; the Defold port
-- uses a fixed logical landscape resolution and lets the engine scale.
local M = {}

M.SCREEN_W = 844
M.SCREEN_H = 390
M.TOP_BAR_HEIGHT = 0
M.QUICK_CAST_BAR_HEIGHT = 0
M.HUD_HEIGHT = 0
M.PLAY_H = M.SCREEN_H - M.TOP_BAR_HEIGHT - M.QUICK_CAST_BAR_HEIGHT - M.HUD_HEIGHT

-- The play field's placement in Defold screen space (origin bottom-left).
-- Sim coordinates stay in the React frame: x right, y DOWN from the top of the
-- play area. to_world converts a sim position to world/GUI coords.
M.PLAY_BOTTOM = M.HUD_HEIGHT + M.QUICK_CAST_BAR_HEIGHT
M.PLAY_TOP = M.PLAY_BOTTOM + M.PLAY_H

function M.to_world_x(x) return x end
function M.to_world_y(y) return M.PLAY_TOP - y end

return M
