-- Account meta progression and run saves, ported from menu.tsx.
-- AsyncStorage JSON blobs become sys.save/sys.load table files.
local skills = require("game.skills")
local combat = require("game.combat")
local upgrades = require("game.upgrades")
local inventory = require("game.inventory")

local M = {}
local test_storage = nil

-- v4: passives are gone from meta -- they moved to run upgrades. v3: run
-- saves carry upgrades instead of equipped/bag items, and the player has no
-- level/xp/mana of his own. v2: meta gained per-skill xp.
M.RUNS_FILE = "runs_v4"
-- The legacy meta filename remains readable for migration helpers, while
-- current progression is stored inside each unfinished run save.
M.META_FILE = "meta_v5"

local function save_path(name)
	return sys.get_save_file("emojiautobattler", name)
end

-- Rank 1 is unlocked with a skill point; rank 2-4 are earned in the field
-- (see game.sim's grant_skill_kill_xp and grant_wave_clear_xp).
function M.default_meta()
	-- Every skill starts locked (level 0); unlocking one costs a skill point
	-- and sets it to rank 1. A fresh account has one point and one equip slot.
	local skill_levels = {}
	local skill_xp = {}
	for _, s in ipairs(skills.ALL_SKILLS) do
		skill_levels[s] = 0
		skill_xp[s] = 0
	end
	return {
		gold = 0,
		skill_points = 1,
		skill_levels = skill_levels,
		skill_xp = skill_xp,
		loadout = {},
		slots_unlocked = 1,
		equipment = {},
	}
end

local function contains(list, v)
	for _, x in ipairs(list) do
		if x == v then return true end
	end
	return false
end

-- Fill in any skills a stored meta predates; drop equipped entries the player
-- no longer owns, so the shape is always complete and valid.
function M.sanitize_meta(raw)
	local base = M.default_meta()
	if not raw then return base end
	local skill_levels = base.skill_levels
	if raw.skill_levels then
		for k, v in pairs(raw.skill_levels) do
			-- Levels are 0 (locked) through ABILITY_MAX_LEVEL.
			if skill_levels[k] ~= nil then skill_levels[k] = math.max(0, math.min(skills.ABILITY_MAX_LEVEL, v)) end
		end
	end
	local slots = math.max(1, math.min(skills.MAX_EQUIPPED, math.floor(raw.slots_unlocked or 1)))
	local loadout = {}
	for _, s in ipairs(raw.loadout or {}) do
		if contains(skills.ALL_SKILLS, s) and (skill_levels[s] or 0) > 0 and #loadout < slots then
			loadout[#loadout + 1] = s
		end
	end
	local skill_xp = base.skill_xp
	if raw.skill_xp then
		for k, v in pairs(raw.skill_xp) do
			if skill_xp[k] ~= nil then skill_xp[k] = v end
		end
	end
	return {
		gold = math.max(0, raw.gold or 0),
		skill_points = math.max(0, math.floor(raw.skill_points == nil and 1 or raw.skill_points)),
		skill_levels = skill_levels,
		skill_xp = skill_xp,
		loadout = loadout,
		slots_unlocked = slots,
		equipment = inventory.sanitize_equipment(raw.equipment),
	}
end

function M.load_meta()
	if test_storage then return M.sanitize_meta(test_storage.meta) end
	local ok, raw = pcall(sys.load, save_path(M.META_FILE))
	if ok and raw and next(raw) then return M.sanitize_meta(raw) end
	return M.default_meta()
end

function M.persist_meta(meta)
	if test_storage then test_storage.meta = meta return true end
	pcall(sys.save, save_path(M.META_FILE), meta)
end

function M.set_test_storage(storage)
	test_storage = storage
end

function M.checkpoint_for_waves_cleared(waves)
	return math.max(0, math.floor((waves or 0) / 5))
end

function M.load_runs()
	if test_storage then return test_storage.runs or {} end
	local ok, raw = pcall(sys.load, save_path(M.RUNS_FILE))
	if ok and raw and raw.runs then return raw.runs end
	return {}
end

function M.persist_runs(runs)
	if test_storage then test_storage.runs = runs return true end
	pcall(sys.save, save_path(M.RUNS_FILE), { runs = runs })
end

-- Build the three run slots from the equipped loadout and bought levels.
function M.make_abilities(loadout, skill_levels)
	local function slot_for(i)
		local skill = loadout[i]
		return { skill = skill, level = skill and (skill_levels[skill] or 0) or 0, cooldown = 0 }
	end
	return { slot_for(1), slot_for(2), slot_for(3) }
end

function M.build_fresh_state(meta)
	return {
		player = combat.make_player(),
		abilities = M.make_abilities(meta.loadout, meta.skill_levels),
		upgrades = {},
		wave = 0,
		map_index = 1,
		route_column = 2,
		route_history = { 2 },
	}
end

function M.build_test_state(meta)
	local player = combat.make_player()
	local target_wave = 9
	local ups = {}
	for _ = 1, 3 do
		local offer = upgrades.roll_offers(target_wave)[1]
		ups[#ups + 1] = offer
	end
	player.hp = player.max_hp
	return {
		player = player,
		abilities = M.make_abilities(meta.loadout, meta.skill_levels),
		upgrades = ups,
		wave = target_wave,
		map_index = math.floor(target_wave / 5) + 1,
		route_column = 2,
		route_history = { 2 },
	}
end

function M.build_state_from_save(save)
	local player = combat.make_player()
	player.hp = save.hp or player.hp
	local run_meta = M.sanitize_meta(save.run_meta)
	return {
		player = player,
		abilities = M.make_abilities(run_meta.loadout, run_meta.skill_levels),
		upgrades = save.upgrades or {},
		wave = save.wave,
		map_index = save.map_index or math.floor((save.wave or 0) / 5) + 1,
		route_column = save.route_column or 2,
		route_history = save.route_history or {},
		route_grid = save.route_grid,
		route_pending = save.route_pending or false,
		upgrade_owed = save.upgrade_owed or false,
		restored = true,
	}
end

return M
