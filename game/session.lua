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
	current_run_id = nil,
	is_test_run = false,
	-- overlays pause the simulation
	overlay = nil, -- "settings" | "inventory" | "skills" | "mobstats" | nil
	tooltip = nil,
	game_over_shown = false,
	reward_item = nil,
	checkpoint_reward_open = false,
	-- The road shown before the first wave: the story ends, the journey is
	-- laid out, and the run waits on Start. Not saved -- it belongs to the
	-- opening of a fresh run, not to the run's state.
	map_intro = false,
	run_active = false,
	debug_progress = false,
	skill_selection_open = false,
	-- settings
	sfx_off = false,
	music_off = true,
	all_sound_off = false,
	weather_off = false,
	tech_on = false,
	-- Trying out new arena art side by side with the old (not saved, like
	-- the toggles above). The puddle map still belongs to the OLD art.
	bane1_bg = false,
}

function M.load()
	-- Account-wide progression was retired. The main menu always starts from
	-- a clean run template; unfinished runs carry their own progression.
	M.meta = meta_mod.default_meta()
	local loaded = meta_mod.load_runs()
	local newest = nil
	for _, save in ipairs(loaded) do
		if not newest or (save.saved_at or 0) > (newest.saved_at or 0) then
			newest = save
		end
	end
	M.saved_runs = newest and { newest } or {}
	if #loaded ~= #M.saved_runs then meta_mod.persist_runs(M.saved_runs) end
	M.runs_loaded = true
end

function M.new_run_meta()
	return meta_mod.default_meta()
end

local function deep_copy(value, seen)
	if type(value) ~= "table" then return value end
	seen = seen or {}
	if seen[value] then return seen[value] end
	local copy = {}
	seen[value] = copy
	for key, child in pairs(value) do
		copy[deep_copy(key, seen)] = deep_copy(child, seen)
	end
	return copy
end

local function attach_progress(save)
	save.run_meta = deep_copy(M.meta)
	save.checkpoint_reward_open = M.checkpoint_reward_open
	save.reward_item = deep_copy(M.reward_item)
	save.skill_selection_open = M.skill_selection_open
	return save
end

function M.commit_meta(next_meta)
	M.meta = next_meta
end

function M.begin_fresh_progress()
	local debug_gold = M.debug_progress and 1000 or 0
	local debug_sp = M.debug_progress and 1000 or 0
	M.meta = M.new_run_meta()
	M.meta.gold = M.meta.gold + debug_gold
	M.meta.skill_points = M.meta.skill_points + debug_sp
	M.debug_progress = false
	M.run_active = true
	M.checkpoint_reward_open = false
	M.reward_item = nil
	M.skill_selection_open = true
end

function M.restore_run_progress(save)
	M.meta = meta_mod.sanitize_meta(save.run_meta)
	M.run_active = true
	-- A continued run is already on the road; only a fresh one is shown it.
	M.map_intro = false
	M.checkpoint_reward_open = save.checkpoint_reward_open == true
	M.reward_item = save.reward_item
	M.skill_selection_open = save.skill_selection_open == true
		or #M.meta.loadout == 0
end

function M.discard_run_progress()
	M.meta = M.new_run_meta()
	M.run_active = false
	M.checkpoint_reward_open = false
	M.reward_item = nil
	M.skill_selection_open = false
	M.map_intro = false
end

function M.set_skill_selection_open(open)
	M.skill_selection_open = open == true
end

-- Refresh the live run after changing its loadout. Preserve a cooldown only
-- when the same skill remains in the same slot; newly equipped skills start
-- ready for use.
function M.sync_run_abilities()
	if not M.sim or not M.meta then return end
	local next_abilities = meta_mod.make_abilities(M.meta.loadout, M.meta.skill_levels)
	for i, ability in ipairs(next_abilities) do
		local previous = M.sim.abilities and M.sim.abilities[i]
		if previous and previous.skill == ability.skill then
			ability.cooldown = previous.cooldown or 0
		end
	end
	M.sim.abilities = next_abilities
	M.sim.skill_levels = {}
	M.sim.skill_xp = {}
	for skill, level in pairs(M.meta.skill_levels) do M.sim.skill_levels[skill] = level end
	for skill, xp in pairs(M.meta.skill_xp) do M.sim.skill_xp[skill] = xp end
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
	if M.sim then
		local inventory = require("game.inventory")
		local old_max_bonus = M.sim.gear_bonus.max_health or 0
		M.sim.gear_bonus = inventory.bonuses(M.meta.equipment)
		local max_delta = M.sim.gear_bonus.max_health - old_max_bonus
		M.sim.player.max_hp = math.max(1, M.sim.player.max_hp + max_delta)
		M.sim.player.hp = math.min(M.sim.player.max_hp,
			M.sim.player.hp + math.max(0, max_delta))
	end
	M.commit_meta(M.meta)
	M.reward_item = nil
	return true
end

-- opening: the first three maps, before the princess wakes. They pay gold and
-- gear only -- a skill point would have nowhere to go, since the skill tree
-- opens with the awakening heart.
function M.grant_checkpoint_reward(wave, opening)
	M.prepare_reward(wave)
	M.meta.gold = (M.meta.gold or 0) + 10
	if not opening then
		M.meta.skill_points = (M.meta.skill_points or 0) + 1
	end
	M.checkpoint_reward_open = true
	M.commit_meta(M.meta)
end

function M.trash_reward()
	if not M.reward_item then return false end
	M.reward_item = nil
	return true
end

function M.paused()
	if M.overlay ~= nil or M.tooltip ~= nil then return true end
	-- The road is being read; nothing walks it yet.
	if M.map_intro then return true end
	-- The wave-clear choice pauses the field too, the same as any overlay --
	-- it just isn't one, since it opens itself rather than being toggled.
	if M.sim and #M.sim.pending_upgrade_offers > 0 then return true end
	if M.sim and M.sim.route_pending and M.sim.upgrade_offer_timer == nil
		and #M.sim.pending_upgrade_offers == 0 then return true end
	return false
end

function M.delete_run(id)
	local next_runs = {}
	for _, r in ipairs(M.saved_runs) do
		if r.id ~= id then next_runs[#next_runs + 1] = r end
	end
	M.saved_runs = next_runs
	meta_mod.persist_runs(next_runs)
end

-- Combat XP remains live until the next map-entry snapshot.
function M.apply_skill_progress(skill, level, xp)
	local m = M.meta
	if not m then return end
	m.skill_levels[skill] = level
	m.skill_xp[skill] = xp
end

function M.store_run(save)
	-- There is exactly one run save. A new map atomically replaces the prior
	-- map-start snapshot, while the stored table stays isolated from live state.
	local snapshot = attach_progress(deep_copy(save))
	M.saved_runs = { snapshot }
	meta_mod.persist_runs(M.saved_runs)
	return snapshot
end

function M.clear_saved_run()
	M.saved_runs = {}
	meta_mod.persist_runs(M.saved_runs)
end

function M.current_save()
	return M.saved_runs[1]
end

return M
