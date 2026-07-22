-- Deterministic boot-time test suite. Runs in debug builds; validates the
-- ported logic with assertions and prints a summary the build pipeline can
-- check in the engine log.
local combat = require("game.combat")
local skills = require("game.skills")
local upgrades = require("game.upgrades")
local meta_mod = require("game.meta")
local sim = require("game.sim")
local session = require("game.session")

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

	-- wave math
	check("mob_count wave 3", combat.mob_count_for_wave(3) == 7)
	check("ranged wave 2", combat.ranged_count_for_wave(2) == 0)
	check("ranged wave 3", combat.ranged_count_for_wave(3) == 1)
	check("ranged wave 8", combat.ranged_count_for_wave(8) == 6)
	check("boss tier wave 2", combat.boss_tier_for_wave(2) == 0)
	check("boss tier wave 3", combat.boss_tier_for_wave(3) == 1)
	check("boss tier wave 6", combat.boss_tier_for_wave(6) == 2)
	check("boss tier wave 7", combat.boss_tier_for_wave(7) == 0)
	local q = combat.build_wave_queue(6)
	check("wave 6 queue ends with boss", q[#q] == "boss")
	check("wave 6 queue size", #q == combat.mob_count_for_wave(6) + 1)
	check("mob spawn interval doubled", near(combat.WAVE_SPAWN_INTERVAL, 2.0))
	local st = combat.mob_type_stats("ranged", 5)
	check("ranged hp is flat", st.hp == 14 and combat.mob_type_stats("ranged", 20).hp == 14)
	check("melee hp is flat", combat.mob_type_stats("melee", 1).hp == 20
		and combat.mob_type_stats("melee", 20).hp == 20)
	check("boss stats are flat", combat.mob_type_stats("boss", 3).hp == 530
		and combat.mob_type_stats("boss", 30).hp == 530)
	check("melee damage is flat swapped value", combat.mob_type_stats("melee", 1).damage == 2
		and combat.mob_type_stats("melee", 20).damage == 2)
	check("ranged damage is flat swapped value", combat.mob_type_stats("ranged", 1).damage == 3
		and combat.mob_type_stats("ranged", 20).damage == 3)
	check("boss damage is flat", combat.mob_type_stats("boss", 3).damage == 12
		and combat.mob_type_stats("boss", 30).damage == 12)
	local close_shove = combat.spawn_mob("melee", 1)
	close_shove.pos = { x = 20, y = 0 }
	combat.shove_mob(close_shove, { x = 0, y = 0 }, combat.PLAYER_ATTACK_RANGE)
	local edge_shove = combat.spawn_mob("melee", 1)
	edge_shove.pos = { x = combat.PLAYER_ATTACK_RANGE, y = 0 }
	combat.shove_mob(edge_shove, { x = 0, y = 0 }, combat.PLAYER_ATTACK_RANGE)
	check("player shove is stronger up close", close_shove.knock.x > edge_shove.knock.x)
	check("player shove is zero at max range", near(edge_shove.knock.x, 0))
	local top_allies = combat.make_allies_for_level(2, { x = 100, y = 0 }, skills.ability1_stats)
	check("wild boar always summons one ally", #top_allies == 1)
	local allies_outside_top_buffer = true
	for _, ally in ipairs(top_allies) do
		if ally.pos.y < combat.ALLY_RADIUS + combat.PLAYER_TOP_BUFFER then
			allies_outside_top_buffer = false
		end
	end
	check("summoned allies spawn below top buffer", allies_outside_top_buffer)

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

	-- upgrades: flat effects that stack additively, with Comboer amplifying
	-- every other upgrade by 10% per pick.
	check("upgrade describe", upgrades.describe({ kind = "vampire" }):find("Lifesteal") ~= nil)
	local b_stack = upgrades.bonuses({ { kind = "vampire" }, { kind = "vampire" } })
	check("upgrade stacks same kind", near(b_stack.lifesteal, 0.4))
	local b_solo = upgrades.bonuses({ { kind = "spellcaster" } })
	check("spellcaster cooldown", near(b_solo.cooldown, 0.3))
	check("untouched kind is zero", b_solo.lifesteal == 0)
	local b_combo = upgrades.bonuses({ { kind = "summoner" }, { kind = "comboer" } })
	check("comboer amplifies other upgrades", near(b_combo.summon_health, 0.5 * 1.1))
	check("comboer does not amplify itself (combo field)", near(b_combo.combo, 0.1))
	local offers = upgrades.roll_offers(5)
	check("three offers", #offers == 3)
	local kinds = {}
	for _, o in ipairs(offers) do kinds[o.kind] = true end
	local distinct = 0
	for _ in pairs(kinds) do distinct = distinct + 1 end
	check("offers are distinct kinds", distinct == 3)

	-- skills: catalog and per-skill xp curve. No passives here any more --
	-- Haste/Summon Regen/Pierce moved to game.upgrades.
	check("cone range", near(skills.CONE_RANGE, math.sqrt(390 ^ 2 + 686 ^ 2)))
	check("wild boar lvl3", skills.ability1_stats(3).hp == 200 and skills.ability1_stats(3).damage == 15)
	check("wild boar health curve", skills.ability1_stats(1).hp == 40 and skills.ability1_stats(4).hp == 400)
	check("seagull lvl4 stats", skills.seagull_stats(4).hp == 160 and skills.seagull_stats(4).damage == 40)
	check("seagull requires wild boar", skills.SKILL_PARENT.seagull == "summon")
	check("fire enrage damage curve", skills.fireball_attack_damage(1) == 20 and skills.fireball_attack_damage(4) == 50)
	check("chain lightning curve", skills.chain_lightning_hits(1) == 3 and skills.chain_lightning_hits(4) == 6
		and skills.chain_lightning_damage(1) == 50 and skills.chain_lightning_damage(4) == 200)
	check("chain lightning requires shockwave", skills.SKILL_PARENT.chainlightning == "cone")
	check("sword throw curve", near(skills.sword_throw_percent(1), 2.0) and near(skills.sword_throw_percent(4), 3.5))
	check("sword throw requires berserker", skills.SKILL_PARENT.swordthrow == "ranged")
	check("burn pct lvl4", skills.burn_explode_percent(4) == 1.0)
	check("xp to next lvl1", skills.skill_xp_to_next(1) == 150)
	check("xp to next lvl4 (maxed)", skills.skill_xp_to_next(4) == nil)
	check("berserker active lifesteal", near(skills.BERSERKER_LIFESTEAL, 0.5))
	check("berserker has no health passive", skills.BERSERKER_BONUS_HP == nil and skills.BERSERKER_REGEN == nil)
	check("berserker tooltip copy", skills.skill_description("ranged") == "Tap to gain +50% attack speed and 50% lifesteal for 5s")
	local no_passives = true
	for _, sid in ipairs(skills.ALL_SKILLS) do
		if sid == "pierce" or sid == "cdreduce" or sid == "summonregen" then no_passives = false end
	end
	check("no passive skills remain in the tree", no_passives)

	-- fire_cone: mob dead ahead is hit, mob behind is not
	local mobs = {
		{ id = 1, pos = { x = 100, y = 0 }, max_hp = 100, hp = 100 },
		{ id = 2, pos = { x = -100, y = 0 }, max_hp = 100, hp = 100 },
		{ id = 3, pos = { x = 100, y = 500 }, max_hp = 100, hp = 100 },
	}
	local hits = skills.fire_cone({ x = 0, y = 0 }, { x = 200, y = 0 }, mobs, 10, 0.1, skills.CONE_RANGE, 21)
	check("cone hits ahead only", #hits == 1 and hits[1].id == 1)
	check("cone damage math", near(hits[1].amount, 10 + 100 * 0.1))

	-- meta defaults: every skill starts locked (level 0), 5 starting gold
	local dm = meta_mod.default_meta()
	local all_locked = true
	for _, sid in ipairs(skills.ALL_SKILLS) do
		if dm.skill_levels[sid] ~= 0 then all_locked = false end
	end
	check("every skill starts locked", all_locked)
	check("starts with 5 gold", dm.gold == 5)
	check("default loadout empty", #dm.loadout == 0)
	check("default one slot unlocked", dm.slots_unlocked == 1)

	local sanitized = meta_mod.sanitize_meta({
		gold = 12,
		slots_unlocked = 2,
		skill_levels = { summon = 2, fireball = 1, burn = 0 },
		skill_xp = { summon = 40 },
		loadout = { "summon", "fireball" },
	})
	check("sanitize gold", sanitized.gold == 12)
	check("sanitize keeps slots unlocked", sanitized.slots_unlocked == 2)
	check("sanitize keeps summon level", sanitized.skill_levels.summon == 2)
	check("sanitize keeps a locked skill locked", sanitized.skill_levels.burn == 0)
	check("sanitize keeps loadout",
		#sanitized.loadout == 2 and sanitized.loadout[1] == "summon" and sanitized.loadout[2] == "fireball")
	-- Loadout is clamped to the unlocked slot count.
	local clamped = meta_mod.sanitize_meta({
		slots_unlocked = 1,
		skill_levels = { summon = 1, cone = 1, ranged = 1 },
		loadout = { "summon", "cone", "ranged" },
	})
	check("sanitize clamps loadout to slots", #clamped.loadout == 1)
	check("sanitize keeps skill xp", sanitized.skill_xp.summon == 40)
	check("gold for waves", meta_mod.gold_for_waves_cleared(4) == 10)
	check("gold for zero waves", meta_mod.gold_for_waves_cleared(0) == 0)

	-- abilities built from loadout
	local ab = meta_mod.make_abilities({ "cone" }, { cone = 3 })
	check("ability slot 1", ab[1].skill == "cone" and ab[1].level == 3)
	check("ability slot 2 empty", ab[2].skill == nil and ab[2].level == 0)

	-- sim: fresh state walks through the entrance and draws
	local gs = meta_mod.build_fresh_state(dm)
	local s = sim.new(gs, { run_id = "test", is_test_run = true, skill_levels = dm.skill_levels, skill_xp = dm.skill_xp })
	-- The default loadout is empty and skills start locked now, so equip the
	-- three roots at rank 1 explicitly for this end-to-end wave test.
	s.abilities = meta_mod.make_abilities({ "summon", "cone", "ranged" }, { summon = 1, cone = 1, ranged = 1 })
	s.wave_countdown = nil -- drive waves manually here, no auto-launch
	check("player starts entering", s.player.intro_phase == "enter")
	for _ = 1, 600 do sim.update(s, 1 / 60) end
	check("intro completes", s.player.intro_phase == "done")
	check("player inside field", s.player.pos.y < 686)
	local saw_draw = false
	for _, ev in ipairs(sim.take_events(s)) do
		if ev.type == "sfx" and ev.name == "draw" then saw_draw = true end
	end
	check("draw sound fired", saw_draw)

	-- sim: wave spawns and clears; a non-boss wave hands out no upgrade choice
	sim.start_next_wave(s)
	check("wave counter", s.wave == 1)
	check("wave queued", #s.wave_queues == 1)
	for _ = 1, 60 * 60 do
		sim.update(s, 1 / 60)
		sim.take_events(s)
		if #s.loot_owed == 0 and not s.wave_active then break end
	end
	check("wave 1 cleared", s.highest_wave_cleared == 1)
	check("player survived wave 1", s.player.hp > 0)
	check("no upgrade offer on a non-boss wave", #s.pending_upgrade_offers == 0)

	-- sim: movement is withheld until an offer is answered, then resumes.
	-- Boss waves are what queue offers; inject one here to drive the flow.
	s.pending_upgrade_offers[1] = upgrades.roll_offers(3)
	check("injected offer has three choices", #s.pending_upgrade_offers[1] == 3)
	local before = s.player.target
	sim.tap_field(s, 10, 10)
	check("move withheld while offer pending", s.player.target == before)
	sim.choose_upgrade(s, 1)
	check("offer answered", #s.pending_upgrade_offers == 0)
	check("upgrade recorded", #s.upgrades == 1)
	sim.tap_field(s, 10, 10)
	check("move accepted once answered", s.player.target ~= nil and s.player.target.x == 10)
	check("player target respects top buffer", s.player.target.y == combat.PLAYER_RADIUS + combat.PLAYER_TOP_BUFFER)

	-- sim: cone cast queues wave-riding hits, and kills with it level the skill
	local gs2 = meta_mod.build_fresh_state(dm)
	local skill_levels2, skill_xp2 = {}, {}
	for k, v in pairs(dm.skill_levels) do skill_levels2[k] = v end
	for k, v in pairs(dm.skill_xp) do skill_xp2[k] = v end
	skill_levels2.cone = 1 -- skills start locked now; unlock cone for this test
	local s2 = sim.new(gs2, { is_test_run = true, skill_levels = skill_levels2, skill_xp = skill_xp2 })
	s2.wave_countdown = nil -- manual wave control for this test
	-- Cone alone in slot 1, nothing else equipped -- so the ordinary auto-
	-- attack stays a short-range sword swing and cannot reach the mob first
	-- and steal credit for the kill from the cone's own delayed hit.
	s2.abilities = {
		{ skill = "cone", level = skill_levels2.cone, cooldown = 0 },
		{ skill = nil, level = 0, cooldown = 0 },
		{ skill = nil, level = 0, cooldown = 0 },
	}
	for _ = 1, 600 do sim.update(s2, 1 / 60) end
	s2.mobs[#s2.mobs + 1] = combat.spawn_mob("melee", 1)
	s2.mobs[1].pos = { x = s2.player.pos.x, y = s2.player.pos.y - 200 }
	s2.mobs[1].hp = 1 -- dies the instant the cone lands
	s2.mobs[1].max_hp = 1
	s2.player.facing = 6 -- north, toward the mob
	check("cone equipped by default", s2.abilities[1].skill == "cone")
	sim.press_ability(s2, 1)
	check("cone hit queued, not landed", #s2.cone_hits == 1 and s2.mobs[1].hp == s2.mobs[1].max_hp)
	check("cone zone added", #s2.cone_zones == 1)
	local xp_before = s2.skill_xp.cone
	for _ = 1, 120 do sim.update(s2, 1 / 60) end
	sim.take_events(s2)
	check("cone kill landed", #s2.mobs == 0)
	check("cone kill granted skill xp", s2.skill_xp.cone > xp_before)

	-- sim: wave-clear itself grants xp to every equipped skill, not only the
	-- one that gets kills -- half the progress comes from clearing waves.
	local skill_levels7, skill_xp7 = {}, {}
	for k, v in pairs(dm.skill_levels) do skill_levels7[k] = v end
	for k, v in pairs(dm.skill_xp) do skill_xp7[k] = v end
	skill_levels7.summon, skill_levels7.cone = 1, 1 -- unlock the two equipped skills
	local s7 = sim.new(meta_mod.build_fresh_state(dm), { is_test_run = true, skill_levels = skill_levels7, skill_xp = skill_xp7 })
	s7.player.intro_phase = "done"
	s7.player.target = nil
	s7.abilities = {
		{ skill = "summon", level = 1, cooldown = 0 },
		{ skill = "cone", level = 1, cooldown = 0 },
		{ skill = nil, level = 0, cooldown = 0 },
	}
	s7.loot_owed = { 1 }
	local before_summon, before_cone = s7.skill_xp.summon, s7.skill_xp.cone
	sim.update(s7, 1 / 60)
	check("wave clear grants xp to equipped summon with no kill", s7.skill_xp.summon > before_summon)
	check("wave clear grants xp to equipped cone with no kill", s7.skill_xp.cone > before_cone)
	check("wave clear does not touch an unequipped skill", s7.skill_xp.burn == 0)

	-- sim: Vampire lifesteal heals the player off the damage they deal.
	local s9 = sim.new(meta_mod.build_fresh_state(dm), { is_test_run = true })
	s9.player.intro_phase = "done"
	s9.player.target = nil
	s9.player.pos = { x = 195, y = 400 }
	s9.player.max_hp = 200
	s9.player.hp = 100
	s9.abilities = { { skill = nil, level = 0, cooldown = 0 }, { skill = nil, level = 0, cooldown = 0 }, { skill = nil, level = 0, cooldown = 0 } }
	s9.upgrades = { { kind = "vampire" } } -- lifesteal 20%
	local ls_mob = combat.spawn_mob("melee", 1)
	ls_mob.pos = { x = s9.player.pos.x + 10, y = s9.player.pos.y }
	ls_mob.hp, ls_mob.max_hp = 9999, 9999 -- survives so the swing keeps landing
	ls_mob.damage = 0 -- doesn't hit back, so only lifesteal moves the player's HP
	s9.mobs = { ls_mob }
	local hp_before_ls = s9.player.hp
	for _ = 1, 120 do sim.update(s9, 1 / 60) end
	check("vampire lifesteal heals the player", s9.player.hp > hp_before_ls)

	-- sim: Berserker's five-second active grants lifesteal without Vampire.
	local s10 = sim.new(meta_mod.build_fresh_state(dm), { is_test_run = true })
	s10.player.intro_phase = "done"
	s10.player.target = nil
	s10.player.pos = { x = 195, y = 400 }
	s10.player.max_hp = 200
	s10.player.hp = 100
	s10.abilities = { { skill = "ranged", level = 1, cooldown = 0 }, { skill = nil, level = 0, cooldown = 0 }, { skill = nil, level = 0, cooldown = 0 } }
	sim.update(s10, 1)
	check("player has two health regen per second", near(s10.player.hp, 102))
	local berserker_mob = combat.spawn_mob("melee", 1)
	berserker_mob.pos = { x = s10.player.pos.x + 10, y = s10.player.pos.y }
	berserker_mob.hp, berserker_mob.max_hp = 9999, 9999
	berserker_mob.damage = 0
	s10.mobs = { berserker_mob }
	sim.press_ability(s10, 1)
	local hp_before_berserker = s10.player.hp
	for _ = 1, 120 do sim.update(s10, 1 / 60) end
	check("berserker active lifesteal heals the player", s10.player.hp > hp_before_berserker)

	-- sim: clearing a wave does not restore health beyond normal regeneration.
	local no_clear_heal = sim.new(meta_mod.build_fresh_state(dm), { is_test_run = true })
	no_clear_heal.player.intro_phase = "done"
	no_clear_heal.player.hp = 50
	no_clear_heal.loot_owed = { 1 }
	sim.update(no_clear_heal, 1)
	check("wave clear does not heal to full", near(no_clear_heal.player.hp, 52))

	-- sim: ranged enemies cannot acquire or shoot until below the top buffer.
	local ranged_exit = sim.new(meta_mod.build_fresh_state(dm), { is_test_run = true })
	ranged_exit.player.intro_phase = "done"
	ranged_exit.player.pos = { x = 195, y = combat.MOB_RADIUS + 5 }
	local top_ranged = combat.spawn_mob("ranged", 1)
	top_ranged.pos = { x = 195, y = combat.MOB_RADIUS }
	ranged_exit.mobs = { top_ranged }
	sim.update(ranged_exit, 0.1)
	check("ranged mob walks out of top buffer before attacking",
		top_ranged.pos.y > combat.MOB_RADIUS and #ranged_exit.projectiles == 0)

	-- sim: Chain Lightning follows nearest-neighbour order with 20% falloff.
	local chain_state = sim.new(meta_mod.build_fresh_state(dm), { is_test_run = true })
	chain_state.player.intro_phase = "done"
	chain_state.abilities = { { skill = "chainlightning", level = 1, cooldown = 0 }, { skill = nil, level = 0, cooldown = 0 }, { skill = nil, level = 0, cooldown = 0 } }
	chain_state.mobs = {}
	for i = 1, 4 do
		local mob = combat.spawn_mob("melee", 1)
		mob.pos = { x = chain_state.player.pos.x + i * 30, y = chain_state.player.pos.y }
		mob.hp, mob.max_hp, mob.damage = 1000, 1000, 0
		chain_state.mobs[#chain_state.mobs + 1] = mob
	end
	sim.press_ability(chain_state, 1)
	check("chain lightning hits configured count", near(chain_state.mobs[1].hp, 950)
		and near(chain_state.mobs[2].hp, 960) and near(chain_state.mobs[3].hp, 968)
		and near(chain_state.mobs[4].hp, 1000))

	-- sim: a lethal Sword Throw impact immediately clears its own cooldown.
	local sword_state = sim.new(meta_mod.build_fresh_state(dm), { is_test_run = true })
	sword_state.player.intro_phase = "done"
	sword_state.player.target = nil
	sword_state.abilities = { { skill = "swordthrow", level = 1, cooldown = 0 }, { skill = nil, level = 0, cooldown = 0 }, { skill = nil, level = 0, cooldown = 0 } }
	local sword_target = combat.spawn_mob("melee", 1)
	sword_target.pos = { x = sword_state.player.pos.x + 200, y = sword_state.player.pos.y }
	sword_target.hp, sword_target.max_hp, sword_target.damage = 10, 10, 0
	sword_state.mobs = { sword_target }
	sim.press_ability(sword_state, 1)
	check("sword throw starts cooldown", sword_state.abilities[1].cooldown > 0)
	for _ = 1, 60 do sim.update(sword_state, 1 / 60) end
	check("lethal sword throw refreshes cooldown", near(sword_state.abilities[1].cooldown, 0))

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

	-- sim: push shoves and damages everyone, using upgrades instead of items
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

	-- sim: no mana anywhere -- abilities are cooldown-gated only
	local s4b = sim.new(meta_mod.build_fresh_state(dm), { is_test_run = true })
	check("player state has no mana field", s4b.player.mana == nil)
	check("player state has no level/xp fields", s4b.player.level == nil and s4b.player.xp == nil)

	-- save/load roundtrip (uses the real save file path)
	local test_meta = meta_mod.default_meta()
	test_meta.gold = 77
	test_meta.skill_levels.summon = 3
	test_meta.skill_xp.summon = 42
	meta_mod.persist_meta(test_meta)
	local loaded = meta_mod.load_meta()
	check("meta roundtrip gold", loaded.gold == 77)
	check("meta roundtrip skill level", loaded.skill_levels.summon == 3)
	check("meta roundtrip skill xp", loaded.skill_xp.summon == 42)
	meta_mod.persist_meta(meta_mod.default_meta()) -- leave a clean default behind

	local runs = {
		{
			id = "r1", saved_at = 1, wave = 3, hp = 50, max_hp = 100,
			abilities = meta_mod.make_abilities(dm.loadout, dm.skill_levels),
			upgrades = { { kind = "summoner" } },
		},
	}
	meta_mod.persist_runs(runs)
	local loaded_runs = meta_mod.load_runs()
	check("runs roundtrip", #loaded_runs == 1 and loaded_runs[1].wave == 3)
	local restored = meta_mod.build_state_from_save(loaded_runs[1])
	check("state from save", restored.player.hp == 50 and restored.wave == 3 and #restored.upgrades == 1)
	meta_mod.persist_runs({})

	-- sim: dying plays the fall, then reports game over exactly once
	local s5 = sim.new(meta_mod.build_fresh_state(dm), { run_id = "r-go", is_test_run = false })
	s5.player.intro_phase = "done"
	s5.player.target = nil
	-- No passive regeneration can revive the player from 0.
	s5.abilities = { { skill = nil, level = 0, cooldown = 0 }, { skill = nil, level = 0, cooldown = 0 }, { skill = nil, level = 0, cooldown = 0 } }
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

	-- sim: clearing a wave with a run id emits an autosave with upgrades
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
	check("autosave carries upgrades field", saw_save.upgrades ~= nil)

	-- session: a pending upgrade choice pauses the field, same as an overlay
	local s8 = sim.new(meta_mod.build_fresh_state(dm), { is_test_run = true })
	session.sim = s8
	session.overlay = nil
	session.tooltip = nil
	check("session runs while nothing is pending", not session.paused())
	s8.pending_upgrade_offers = { upgrades.roll_offers(1) }
	check("session pauses on a pending upgrade offer", session.paused())
	s8.pending_upgrade_offers = {}
	check("session resumes once answered", not session.paused())
	session.sim = nil

	print(("PORT TESTS: %d passed, %d failed"):format(passed, failed))
	return failed == 0
end

return M
