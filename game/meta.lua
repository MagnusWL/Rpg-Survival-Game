-- Account meta progression and run saves, ported from menu.tsx.
-- AsyncStorage JSON blobs become sys.save/sys.load table files.
local skills = require("game.skills")
local combat = require("game.combat")
local upgrades = require("game.upgrades")
local inventory = require("game.inventory")

local M = {}

-- v4: passives are gone from meta -- they moved to run upgrades. v3: run
-- saves carry upgrades instead of equipped/bag items, and the player has no
-- level/xp/mana of his own. v2: meta gained per-skill xp.
M.RUNS_FILE = "runs_v4"
-- v5 is kept so this progression update migrates existing accounts in place.
-- Missing skill-point/checkpoint fields are filled by sanitize_meta.
M.META_FILE = "meta_v5"

local function save_path(name)
	return sys.get_save_file("emojiautobattler", name)
end

-- Every skill starts already owned at rank 1 -- there is no gold unlock step
-- left; rank 2-4 are earned in the field (see game.sim's grant_skill_kill_xp
-- and grant_wave_clear_xp).
function M.default_meta()
	-- Every skill starts locked (level 0); unlocking one in the tree costs gold
	-- and sets it to rank 1. A fresh account has 5 gold -- enough for one root
	-- skill -- and one equip slot open.
	local skill_levels = {}
	local skill_xp = {}
	for _, s in ipairs(skills.ALL_SKILLS) do
		skill_levels[s] = 0
		skill_xp[s] = 0
	end
	return {
		gold = 5,
		skill_points = 1,
		highest_checkpoint_rewarded = 0,
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
		highest_checkpoint_rewarded = math.max(0, math.floor(raw.highest_checkpoint_rewarded or 0)),
		skill_levels = skill_levels,
		skill_xp = skill_xp,
		loadout = loadout,
		slots_unlocked = slots,
		equipment = inventory.sanitize_equipment(raw.equipment),
	}
end

function M.load_meta()
	local ok, raw = pcall(sys.load, save_path(M.META_FILE))
	if ok and raw and next(raw) then return M.sanitize_meta(raw) end
	return M.default_meta()
end

function M.persist_meta(meta)
	pcall(sys.save, save_path(M.META_FILE), meta)
end

-- Gold: clearing wave N in a run banks 1+2+...+N at the end.
function M.gold_for_waves_cleared(waves)
	if waves > 0 then return waves * (waves + 1) / 2 end
	return 0
end

function M.checkpoint_for_waves_cleared(waves)
	return math.max(0, math.floor((waves or 0) / 5))
end

function M.load_runs()
	local ok, raw = pcall(sys.load, save_path(M.RUNS_FILE))
	if ok and raw and raw.runs then return raw.runs end
	return {}
end

function M.persist_runs(runs)
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
	}
end

function M.build_state_from_save(save)
	local player = combat.make_player()
	player.hp = save.hp
	return {
		player = player,
		abilities = save.abilities,
		upgrades = save.upgrades or {},
		wave = save.wave,
		restored = true,
	}
end

return M
