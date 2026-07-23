-- Shared app state blackboard: which screen is up, the running sim, account
-- meta, saved runs, and the settings toggles. Scripts and GUI scripts all
-- require this instead of message-passing large tables around.
local meta_mod = require("game.meta")

local M = {
	screen = "menu", -- menu | continue | skilltree | game
	intro_done = false,
	sim = nil, -- live sim state while a run is up
	meta = nil,
	run_active = false,
	choosing_opening_skill = false,
	checkpoint_reward_open = false,
	saved_runs = {},
	runs_loaded = false,
	last_run_gold = 0,
	last_run_skill_points = 0,
	current_run_id = nil,
	is_test_run = false,
	gold_banked = false,
	skill_points_banked = false,
	-- overlays pause the simulation
	overlay = nil, -- "settings" | "inventory" | "skills" | "mobstats" | nil
	tooltip = nil,
	game_over_shown = false,
	reward_item = nil,
	-- settings
	sfx_off = false,
	music_off = false,
	all_sound_off = false,
	weather_off = false,
	tech_on = false,
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
	if not M.run_active then
		meta_mod.persist_meta(next_meta)
		return
	end
	if M.sim then
		M.sim.skill_levels = next_meta.skill_levels
		M.sim.skill_xp = next_meta.skill_xp
		M.sim.abilities = meta_mod.make_abilities(next_meta.loadout, next_meta.skill_levels)
	end
end

function M.new_run_meta()
	local m = meta_mod.default_meta()
	m.gold = 0
	m.skill_points = 1
	m.highest_checkpoint_rewarded = 0
	m.equipment = {}
	m.loadout = {}
	m.slots_unlocked = 1
	return m
end

function M.prepare_reward(highest_wave)
	if M.is_test_run then M.reward_item = nil return end
	local inventory = require("game.inventory")
	M.reward_item = inventory.roll(inventory.item_level(highest_wave))
end

function M.equip_reward()
	local item = M.reward_item
	if not item or not M.meta then return false end
	M.meta.equipment = M.meta.equipment or {}
	M.meta.equipment[item.slot] = item
	M.commit_meta(M.meta)
	if M.sim then
		local inventory = require("game.inventory")
		M.sim.gear_bonus = inventory.bonuses(M.meta.equipment)
	end
	M.reward_item = nil
	return true
end

function M.grant_checkpoint_reward(wave)
	if M.is_test_run then return end
	local inventory = require("game.inventory")
	local checkpoint = math.max(1, math.floor((wave or 0) / 5))
	M.meta.skill_points = (M.meta.skill_points or 0) + 1
	M.meta.gold = (M.meta.gold or 0) + checkpoint * 5
	M.last_run_gold = checkpoint * 5
	M.last_run_skill_points = 1
	M.reward_item = inventory.roll(inventory.item_level(wave))
	M.checkpoint_reward_open = true
	M.commit_meta(M.meta)
end

function M.paused()
	if M.overlay ~= nil or M.tooltip ~= nil then return true end
	-- The wave-clear choice pauses the field too, the same as any overlay --
	-- it just isn't one, since it opens itself rather than being toggled.
	if M.sim and #M.sim.pending_upgrade_offers > 0 then return true end
	if M.sim and M.sim.route_pending and M.sim.upgrade_offer_timer == nil
		and #M.sim.pending_upgrade_offers == 0 then return true end
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

-- Award every reached five-wave checkpoint once per account. If a player
-- jumps across several new checkpoints in one run, each one pays a point.
function M.bank_skill_points(highest_wave)
	if M.is_test_run or M.skill_points_banked then return end
	M.skill_points_banked = true
	local m = M.meta
	local reached = meta_mod.checkpoint_for_waves_cleared(highest_wave)
	local previous = m.highest_checkpoint_rewarded or 0
	local earned = math.max(0, reached - previous)
	m.highest_checkpoint_rewarded = math.max(previous, reached)
	M.last_run_skill_points = earned
	if earned > 0 then m.skill_points = (m.skill_points or 0) + earned end
	if reached > previous then M.commit_meta(m) end
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
	if M.run_active then
		M.meta = m
		return
	end
	M.commit_meta(m)
end

function M.discard_run_progress()
	M.run_active = false
	M.choosing_opening_skill = false
	M.checkpoint_reward_open = false
	M.reward_item = nil
	M.meta = M.new_run_meta()
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
