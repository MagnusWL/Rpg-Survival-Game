-- Account meta progression and run saves, ported from menu.tsx.
-- AsyncStorage JSON blobs become sys.save/sys.load table files.
local items = require("game.items")
local skills = require("game.skills")
local combat = require("game.combat")

local M = {}

M.RUNS_FILE = "runs_v2"
M.META_FILE = "meta_v1"

local function save_path(name)
	return sys.get_save_file("emojiautobattler", name)
end

function M.default_meta()
	local skill_levels = {}
	for _, s in ipairs(skills.ALL_SKILLS) do skill_levels[s] = 0 end
	for _, root in ipairs(skills.ROOT_SKILLS) do skill_levels[root] = 1 end
	local loadout = {}
	for i, s in ipairs(skills.ROOT_SKILLS) do loadout[i] = s end
	return { gold = 0, skill_levels = skill_levels, loadout = loadout, passive = nil }
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
			if skill_levels[k] ~= nil then skill_levels[k] = v end
		end
	end
	local loadout = {}
	for _, s in ipairs(raw.loadout or base.loadout) do
		if contains(skills.ALL_SKILLS, s) and not skills.is_passive_skill(s)
			and (skill_levels[s] or 0) > 0 and #loadout < skills.MAX_EQUIPPED then
			loadout[#loadout + 1] = s
		end
	end
	local passive = nil
	if raw.passive and contains(skills.ALL_SKILLS, raw.passive)
		and skills.is_passive_skill(raw.passive) and (skill_levels[raw.passive] or 0) > 0 then
		passive = raw.passive
	end
	return { gold = raw.gold or 0, skill_levels = skill_levels, loadout = loadout, passive = passive }
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

local function make_passive(meta)
	if not meta.passive then return nil end
	return { skill = meta.passive, level = meta.skill_levels[meta.passive] or 0 }
end

local function empty_slots(n)
	local t = {}
	for i = 1, n do t[i] = false end
	return t
end

function M.build_fresh_state(meta)
	return {
		player = combat.make_player(),
		abilities = M.make_abilities(meta.loadout, meta.skill_levels),
		passive = make_passive(meta),
		equipped = empty_slots(items.EQUIP_SLOTS),
		bag = empty_slots(items.BAG_SLOTS),
		materials = 0,
		wave = 0,
	}
end

function M.build_test_state(meta)
	local player = combat.make_player()
	local target_level = 10
	local max_hp = player.max_hp
	for _ = 2, target_level do max_hp = max_hp + 10 end
	player.level = target_level
	player.xp = 0
	player.xp_to_next = combat.xp_for_level(target_level)
	player.max_hp = max_hp
	player.hp = max_hp
	local function random_test_item()
		local kind = items.ITEM_KINDS[math.random(#items.ITEM_KINDS)]
		return items.make_item(kind, math.max(1, target_level + math.random(0, 4) - 2))
	end
	local equipped = { random_test_item(), random_test_item(), random_test_item() }
	local bag = empty_slots(items.BAG_SLOTS)
	bag[1], bag[2], bag[3] = random_test_item(), random_test_item(), random_test_item()
	return {
		player = player,
		abilities = M.make_abilities(meta.loadout, meta.skill_levels),
		passive = make_passive(meta),
		equipped = equipped,
		bag = bag,
		materials = 0,
		wave = target_level - 1,
	}
end

function M.build_state_from_save(save)
	local player = combat.make_player()
	player.level = save.level
	player.xp = save.xp
	player.xp_to_next = save.xp_to_next
	player.hp = save.hp
	player.max_hp = save.max_hp
	player.mana = save.mana
	return {
		player = player,
		abilities = save.abilities,
		passive = save.passive,
		equipped = save.equipped,
		bag = save.bag,
		materials = save.materials,
		wave = save.wave,
	}
end

return M
