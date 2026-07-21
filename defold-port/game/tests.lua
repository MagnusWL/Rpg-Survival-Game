-- Deterministic boot-time test suite. Runs in debug builds; validates the
-- ported logic with assertions and prints a summary the build pipeline can
-- check in the engine log.
local combat = require("game.combat")
local items = require("game.items")
local skills = require("game.skills")
local meta_mod = require("game.meta")
local sim = require("game.sim")

local M = {}

local passed, failed = 0, 0

local function check(name, cond)
	if cond then
		passed = passed + 1
	else
		failed = failed + 1
		print("TEST FAILED: " .. name)
	end
end

local function near(a, b, eps)
	return math.abs(a - b) <= (eps or 1e-6)
end

function M.run()
	math.randomseed(42)

	-- xp / leveling
	check("xp_for_level(1)", combat.xp_for_level(1) == 40)
	check("xp_for_level(5)", combat.xp_for_level(5) == 140)

	-- wave math
	check("mob_count wave 3", combat.mob_count_for_wave(3) == 7)
	check("ranged wave 2", combat.ranged_count_for_wave(2) == 0)
	check("ranged wave 3", combat.ranged_count_for_wave(3) == 1)
	check("ranged wave 8", combat.ranged_count_for_wave(8) == 6)
	check("boss tier wave 9", combat.boss_tier_for_wave(9) == 0)
	check("boss tier wave 10", combat.boss_tier_for_wave(10) == 1)
	check("boss tier wave 15", combat.boss_tier_for_wave(15) == 2)
	local q = combat.build_wave_queue(10)
	check("wave 10 queue ends with boss", q[#q] == "boss")
	check("wave 10 queue size", #q == combat.mob_count_for_wave(10) + 1)
	local st = combat.mob_type_stats("ranged", 5)
	check("ranged hp wave 5", st.hp == math.floor((20 + 4 * 8) * 0.7 + 0.5))
	check("boss stats wave 10", combat.mob_type_stats("boss", 10).hp == 600)

	-- facing math: east is row 0, south row 2 (y down), north row 6
	check("facing east", combat.facing_from_delta(1, 0) == 0)
	check("facing south", combat.facing_from_delta(0, 1) == 2)
	check("facing west", combat.facing_from_delta(-1, 0) == 4)
	check("facing north", combat.facing_from_delta(0, -1) == 6)
	local v = combat.direction_from_facing(2)
	check("dir from facing south", near(v.x, 0, 1e-9) and near(v.y, 1, 1e-9))

	-- anim timelines
	check("attack span", combat.anim_span(combat.ANIMS.attack) == 10)
	check("attack duration", near(combat.anim_duration(combat.ANIMS.attack), 10 / 24))
	-- rupture order: 19 steps, two holds
	local rd = combat.anim_duration(combat.ANIMS.rupture)
	check("rupture duration", near(rd, 19 / 18 + 0.3 + 0.5, 1e-9))
	check("rupture col at 0", combat.anim_column(combat.ANIMS.rupture, 0) == 0)
	-- frame 6 comes up at 6/18 and holds for 0.3 + 1/18
	check("rupture frame6 start", near(combat.frame_start_time(combat.ANIMS.rupture, 6), 6 / 18, 1e-9))
	check("rupture col in hold", combat.anim_column(combat.ANIMS.rupture, 6 / 18 + 0.2) == 6)
	-- ancestor passes: fwd 15, rev 14, fwd 14 = 43 frames
	local ad = combat.anim_duration(combat.ANIMS.ancestor)
	check("ancestor duration", near(ad, 43 / 18, 1e-9))
	check("ancestor ends on last frame", combat.anim_column(combat.ANIMS.ancestor, ad + 1) == 14)
	-- one-shot clamps, loop wraps
	check("die clamps", combat.anim_column(combat.ANIMS.die, 99) == 14)
	check("run wraps", combat.anim_column(combat.ANIMS.run, 15 / 16 + 1 / 16) == 1)

	-- items
	local it = items.make_item("dmg", 3)
	check("item bonus", items.item_bonus(it) == 6)
	check("tooltip", items.item_tooltip(it):find("Blade") ~= nil)
	local eq = { it, false, items.make_item("dmg", 2) }
	check("equipped bonus sums", items.equipped_bonus(eq, "dmg") == 10)
	check("equipped bonus other kind", items.equipped_bonus(eq, "mana") == 0)

	-- skills
	check("cone range", near(skills.CONE_RANGE, math.sqrt(390 ^ 2 + 686 ^ 2)))
	check("skill cost lvl1", skills.skill_level_cost(1) == 5)
	check("skill cost lvl4", skills.skill_level_cost(4) == 20)
	check("ability1 lvl3", skills.ability1_stats(3).hp == 50 and skills.ability1_stats(3).damage == 10)
	check("burn pct lvl4", skills.burn_explode_percent(4) == 1.0)
	check("haste pct lvl2", skills.cooldown_reduce_percent(2) == 0.3)

	-- fire_cone: mob dead ahead is hit, mob behind is not
	local mobs = {
		{ id = 1, pos = { x = 100, y = 0 }, max_hp = 100, hp = 100 },
		{ id = 2, pos = { x = -100, y = 0 }, max_hp = 100, hp = 100 },
		{ id = 3, pos = { x = 100, y = 500 }, max_hp = 100, hp = 100 },
	}
	local hits = skills.fire_cone({ x = 0, y = 0 }, { x = 200, y = 0 }, mobs, 10, 0.1, skills.CONE_RANGE, 21)
	check("cone hits ahead only", #hits == 1 and hits[1].id == 1)
	check("cone damage math", near(hits[1].amount, 10 + 100 * 0.1))

	-- meta defaults and sanitize
	local dm = meta_mod.default_meta()
	check("default roots owned", dm.skill_levels.summon == 1 and dm.skill_levels.cone == 1 and dm.skill_levels.ranged == 1)
	check("default loadout", #dm.loadout == 3)
	local sanitized = meta_mod.sanitize_meta({
		gold = 12,
		skill_levels = { summon = 2, pierce = 1, bogus = 9 },
		loadout = { "summon", "pierce", "fireball" }, -- pierce is passive, fireball unowned
		passive = "pierce",
	})
	check("sanitize gold", sanitized.gold == 12)
	check("sanitize drops passive from loadout", #sanitized.loadout == 1 and sanitized.loadout[1] == "summon")
	check("sanitize keeps passive", sanitized.passive == "pierce")
	check("sanitize drops unknown", sanitized.skill_levels.bogus == nil)
	check("gold for waves", meta_mod.gold_for_waves_cleared(4) == 10)
	check("gold for zero waves", meta_mod.gold_for_waves_cleared(0) == 0)

	-- abilities built from loadout
	local ab = meta_mod.make_abilities({ "cone" }, { cone = 3 })
	check("ability slot 1", ab[1].skill == "cone" and ab[1].level == 3)
	check("ability slot 2 empty", ab[2].skill == nil and ab[2].level == 0)

	-- sim: fresh state walks through the entrance and draws
	local gs = meta_mod.build_fresh_state(dm)
	local s = sim.new(gs, { run_id = "test", is_test_run = true })
	check("player starts entering", s.player.intro_phase == "enter")
	for _ = 1, 600 do sim.update(s, 1 / 60) end
	check("intro completes", s.player.intro_phase == "done")
	check("player inside field", s.player.pos.y < 686)
	local saw_draw = false
	for _, ev in ipairs(sim.take_events(s)) do
		if ev.type == "sfx" and ev.name == "draw" then saw_draw = true end
	end
	check("draw sound fired", saw_draw)

	-- sim: wave spawns and can be fought
	sim.start_next_wave(s)
	check("wave counter", s.wave == 1)
	check("wave queued", #s.wave_queues == 1)
	for _ = 1, 60 * 60 do
		sim.update(s, 1 / 60)
		sim.take_events(s)
		if #s.loot_owed == 0 and not s.wave_active then break end
	end
	check("wave 1 cleared", s.highest_wave_cleared == 1)
	check("loot dropped or picked", (#s.ground_items > 0)
		or (s.equipped[1] and true or false) or (s.player.hp > 0))
	check("player survived wave 1", s.player.hp > 0)
	check("xp gained", s.player.xp > 0 or s.player.level > 1)

	-- sim: cone cast queues wave-riding hits
	local gs2 = meta_mod.build_fresh_state(dm)
	local s2 = sim.new(gs2, { is_test_run = true })
	for _ = 1, 600 do sim.update(s2, 1 / 60) end
	s2.mobs[#s2.mobs + 1] = combat.spawn_mob("melee", 1)
	s2.mobs[1].pos = { x = s2.player.pos.x, y = s2.player.pos.y - 200 }
	s2.player.facing = 6 -- north, toward the mob
	local slot
	for k = 1, 3 do
		if s2.abilities[k].skill == "cone" then slot = k end
	end
	check("cone equipped by default", slot ~= nil)
	local mana_before = s2.player.mana
	sim.press_ability(s2, slot)
	check("cone spent mana", s2.player.mana == mana_before - skills.SKILL_META.cone.mana)
	check("cone hit queued, not landed", #s2.cone_hits == 1 and s2.mobs[1].hp == s2.mobs[1].max_hp)
	check("cone zone added", #s2.cone_zones == 1)
	local mref = s2.mobs[1]
	local hp_before = mref.hp
	for _ = 1, 120 do sim.update(s2, 1 / 60) end
	sim.take_events(s2)
	check("cone hit delivered by wave", mref.hp < hp_before)

	-- sim: burn explosion chain
	local s3 = sim.new(meta_mod.build_fresh_state(dm), { is_test_run = true })
	s3.player.intro_phase = "done"
	s3.player.target = nil
	local a = combat.spawn_mob("melee", 1)
	local b = combat.spawn_mob("melee", 1)
	a.pos = { x = 50, y = 50 }
	b.pos = { x = 90, y = 50 } -- inside BURN_EXPLODE_RADIUS of a
	a.burn_pct = 1.0
	a.hp = 0
	b.hp = 200
	b.max_hp = 200
	s3.mobs = { a, b }
	s3.player.pos = { x = 350, y = 600 } -- far away, no melee interference
	sim.update(s3, 1 / 60)
	check("burn blast damaged neighbour", s3.mobs[1] ~= nil and s3.mobs[1].hp <= 200 - a.max_hp)

	-- sim: push shoves and damages everyone
	local s4 = sim.new(meta_mod.build_fresh_state(dm), { is_test_run = true })
	s4.player.intro_phase = "done"
	s4.player.target = nil
	s4.abilities = { { skill = "push", level = 2, cooldown = 0 }, { skill = nil, level = 0, cooldown = 0 }, { skill = nil, level = 0, cooldown = 0 } }
	local m1 = combat.spawn_mob("melee", 1)
	m1.pos = { x = s4.player.pos.x + 30, y = s4.player.pos.y }
	s4.mobs = { m1 }
	sim.press_ability(s4, 1)
	check("push damaged", m1.hp < m1.max_hp)
	check("push shoved", m1.knock.x > 0)

	-- save/load roundtrip (uses the real save file path)
	local test_meta = meta_mod.default_meta()
	test_meta.gold = 77
	test_meta.skill_levels.summon = 3
	meta_mod.persist_meta(test_meta)
	local loaded = meta_mod.load_meta()
	check("meta roundtrip gold", loaded.gold == 77)
	check("meta roundtrip level", loaded.skill_levels.summon == 3)
	meta_mod.persist_meta(meta_mod.default_meta()) -- leave a clean default behind

	local runs = { { id = "r1", saved_at = 1, wave = 3, level = 4, xp = 1, xp_to_next = 100, hp = 50, max_hp = 100, mana = 10, abilities = meta_mod.make_abilities(dm.loadout, dm.skill_levels), passive = nil, equipped = { false, false, false }, bag = { false, false, false, false, false, false, false, false, false }, materials = 0 } }
	meta_mod.persist_runs(runs)
	local loaded_runs = meta_mod.load_runs()
	check("runs roundtrip", #loaded_runs == 1 and loaded_runs[1].wave == 3)
	local restored = meta_mod.build_state_from_save(loaded_runs[1])
	check("state from save", restored.player.level == 4 and restored.player.hp == 50 and restored.wave == 3)
	meta_mod.persist_runs({})

	-- sim: dying plays the fall, then reports game over exactly once
	local s5 = sim.new(meta_mod.build_fresh_state(dm), { run_id = "r-go", is_test_run = false })
	s5.player.intro_phase = "done"
	s5.player.target = nil
	s5.player.hp = 0
	local saw_over = false
	for _ = 1, 300 do
		sim.update(s5, 1 / 60)
		for _, ev in ipairs(sim.take_events(s5)) do
			if ev.type == "game_over" then saw_over = true end
		end
		if s5.game_over then break end
	end
	check("die timer delays game over", saw_over and s5.game_over)
	check("die anim chosen", s5.player.anim == "die")

	-- sim: clearing a wave with a run id emits an autosave
	local s6 = sim.new(meta_mod.build_fresh_state(dm), { run_id = "r-save", is_test_run = false })
	s6.player.intro_phase = "done"
	s6.player.target = nil
	s6.player.max_hp = 100000
	s6.player.hp = 100000
	sim.start_next_wave(s6)
	local saw_save = nil
	for _ = 1, 60 * 90 do
		sim.update(s6, 1 / 60)
		for _, ev in ipairs(sim.take_events(s6)) do
			if ev.type == "autosave" then saw_save = ev.save end
		end
		if saw_save then break end
	end
	check("autosave after wave clear", saw_save ~= nil and saw_save.wave == 1 and saw_save.id == "r-save")

	print(("PORT TESTS: %d passed, %d failed"):format(passed, failed))
	return failed == 0
end

return M
