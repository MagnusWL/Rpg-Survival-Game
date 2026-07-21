-- Shared app state blackboard: which screen is up, the running sim, account
-- meta, saved runs, and the settings toggles. Scripts and GUI scripts all
-- require this instead of message-passing large tables around.
local meta_mod = require("game.meta")

local M = {
	screen = "menu", -- menu | continue | skilltree | game
	intro_done = false,
	sim = nil, -- live sim state while a run is up
	meta = nil,
	saved_runs = {},
	runs_loaded = false,
	last_run_gold = 0,
	current_run_id = nil,
	is_test_run = false,
	gold_banked = false,
	-- overlays pause the simulation
	overlay = nil, -- "settings" | "inventory" | "skills" | "mobstats" | nil
	tooltip = nil,
	game_over_shown = false,
	-- settings
	sfx_off = false,
	music_off = false,
	all_sound_off = false,
	weather_off = false,
	tech_on = true,
	-- Trying out new arena art side by side with the old (not saved, like
	-- the toggles above). The puddle map still belongs to the OLD art.
	bane1_bg = false,
}

function M.load()
	M.meta = meta_mod.load_meta()
	M.saved_runs = meta_mod.load_runs()
	M.runs_loaded = true
end

function M.commit_meta(next_meta)
	M.meta = next_meta
	meta_mod.persist_meta(next_meta)
end

function M.paused()
	if M.overlay ~= nil or M.tooltip ~= nil then return true end
	-- The wave-clear choice pauses the field too, the same as any overlay --
	-- it just isn't one, since it opens itself rather than being toggled.
	if M.sim and #M.sim.pending_upgrade_offers > 0 then return true end
	return false
end

-- Bank this run's gold once (1 per wave cleared: 1+2+...+N).
function M.bank_gold(highest_wave)
	if M.is_test_run or M.gold_banked then return end
	M.gold_banked = true
	local earned = meta_mod.gold_for_waves_cleared(highest_wave)
	if earned > 0 then
		local m = M.meta
		m.gold = m.gold + earned
		M.commit_meta(m)
		M.last_run_gold = earned
	end
end

function M.delete_run(id)
	local next_runs = {}
	for _, r in ipairs(M.saved_runs) do
		if r.id ~= id then next_runs[#next_runs + 1] = r end
	end
	M.saved_runs = next_runs
	meta_mod.persist_runs(next_runs)
end

-- A skill ranked up in the field: fold the new level/xp back into the
-- account meta so it persists across runs, same as gold does.
function M.apply_skill_progress(skill, level, xp)
	local m = M.meta
	if not m then return end
	m.skill_levels[skill] = level
	m.skill_xp[skill] = xp
	M.commit_meta(m)
end

function M.store_run(save)
	local next_runs = {}
	for _, r in ipairs(M.saved_runs) do
		if r.id ~= save.id then next_runs[#next_runs + 1] = r end
	end
	next_runs[#next_runs + 1] = save
	M.saved_runs = next_runs
	meta_mod.persist_runs(next_runs)
end

return M
