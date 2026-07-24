-- Deterministic boot-time test suite. Runs in debug builds; validates the
-- ported logic with assertions and prints a summary the build pipeline can
-- check in the engine log.
local combat = require("game.combat")
local skills = require("game.skills")
local upgrades = require("game.upgrades")
local meta_mod = require("game.meta")
local sim = require("game.sim")
local session = require("game.session")
local layout = require("game.layout")
local inventory = require("game.inventory")

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

	-- run equipment: one fixed slot, level per cleared checkpoint, and
	-- additive stat aggregation without a loose-item bag.
	check("item level starts at one", inventory.item_level(0) == 1)
	do
		local collision_state = sim.new(meta_mod.build_fresh_state(meta_mod.default_meta()), {
			is_test_run = true,
		})
		collision_state.player.intro_phase = "done"
		collision_state.player.pos = { x = 300, y = 200 }
		collision_state.mobs = {
			{ id = 1, hp = 10, pos = { x = 300, y = 200 } },
			{ id = 2, hp = 10, pos = { x = 302, y = 200 } },
		}
		collision_state.allies = {
			{ id = 1, hp = 10, pos = { x = 301, y = 200 } },
		}
		sim.resolve_body_collisions(collision_state)
		local bodies = {
			collision_state.player,
			collision_state.mobs[1],
			collision_state.mobs[2],
			collision_state.allies[1],
		}
		local separated = true
		for i = 1, #bodies - 1 do
			for j = i + 1, #bodies do
				if combat.dist(bodies[i].pos, bodies[j].pos)
					< combat.FEET_COLLISION_RADIUS * 2 - 0.01 then
					separated = false
				end
			end
		end
		check("feet collisions separate player mobs and summons", separated)
	end
	check("item level follows five-wave checkpoints", inventory.item_level(5) == 1 and inventory.item_level(10) == 2)
	check("item stats have strong base and double scaling",
		inventory.stat_multiplier(1) == 4
			and inventory.stat_multiplier(2) == 6
			and inventory.stat_multiplier(4) == 10)
	local item = inventory.roll(3)
	check("rolled item has valid slot and level", inventory.SLOT_LABELS[item.slot] ~= nil and item.level == 3)
	local raw_gear = { [item.slot] = item }
	local invalid_slot = item.slot == "weapon" and "helmet" or "weapon"
	raw_gear[invalid_slot] = { slot = item.slot, stats = {} }
	local clean_gear = inventory.sanitize_equipment(raw_gear)
	check("equipment sanitizer keeps only matching slots", clean_gear[item.slot] == item and clean_gear[invalid_slot] == nil)
	local gear_bonus = inventory.bonuses({ [item.slot] = item })
	local has_bonus = false
	for _, value in pairs(gear_bonus) do if value > 0 then has_bonus = true end end
	check("equipped item contributes bonuses", has_bonus)

	-- wave math
	check("fresh account starts with one skill point", meta_mod.default_meta().skill_points == 1)
	check("checkpoint count follows five waves", meta_mod.checkpoint_for_waves_cleared(4) == 0
		and meta_mod.checkpoint_for_waves_cleared(5) == 1
		and meta_mod.checkpoint_for_waves_cleared(14) == 2)
	check("mob_count wave 3", combat.mob_count_for_wave(3) == 6)
	check("ranged wave 2", combat.ranged_count_for_wave(2) == 0)
	check("no ranged before first checkpoint", combat.ranged_count_for_wave(5) == 0)
	check("ranged begin after first checkpoint", combat.ranged_count_for_wave(6) == 1)
	check("ranged wave 8", combat.ranged_count_for_wave(8) == 2)
	check("boss tier wave 2", combat.boss_tier_for_wave(2) == 0)
	check("boss tier wave 5", combat.boss_tier_for_wave(5) == 1)
	check("boss tier wave 10", combat.boss_tier_for_wave(10) == 2)
	check("boss tier wave 7", combat.boss_tier_for_wave(7) == 0)
	local q = combat.build_wave_queue(10)
	check("wave 10 queue ends with boss", combat.base_mob_type(q[#q]) == "boss")
	check("wave 10 queue size", #q == combat.mob_count_for_wave(10) + 1)
	check("wave queue spawns within five seconds", near(combat.WAVE_SPAWN_WINDOW / #q, 5 / #q))
	local st = combat.mob_type_stats("ranged", 5)
	check("ranged hp is flat", st.hp == 14 and combat.mob_type_stats("ranged", 20).hp == 14)
	check("melee hp is flat", combat.mob_type_stats("melee", 1).hp == 20
		and combat.mob_type_stats("melee", 20).hp == 20)
	check("boss stats are flat", combat.mob_type_stats("boss", 3).hp == 150
		and combat.mob_type_stats("boss", 30).hp == 150)
	check("level 2 zombie starts gentle", combat.mob_type_stats("melee2", 4).hp == 30
		and combat.mob_type_stats("melee2", 4).damage == 3)
	check("level 2 zombies begin after first checkpoint", combat.level2_melee_count_for_wave(5) == 0
		and combat.level2_melee_count_for_wave(6) > 0)
	local first_band = combat.wave_composition(5)
	check("waves 1-5 contain only level 1 melee plus boss", first_band[1].type == "melee"
		and first_band[2].type == "boss")
	local second_band = combat.wave_composition(6)
	check("wave 6 introduces level 2 melee and ranged", second_band[1].type == "melee2"
		and second_band[2].type == "ranged2")
	check("higher mob levels scale exponentially", combat.mob_type_stats("ranged3", 12).hp == 32
		and combat.mob_type_stats("boss4", 24).hp == 506)
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
	local b_power = upgrades.bonuses({ { kind = "abilitypower" }, { kind = "attackdamage" }, { kind = "attackspeed" } })
	check("new combat upgrades", near(b_power.ability_power, 0.25)
		and near(b_power.attack_damage, 5) and near(b_power.attack_speed, 0.2))
	local offers = upgrades.roll_offers(5)
	check("three offers", #offers == 3)
	local kinds = {}
	for _, o in ipairs(offers) do kinds[o.kind] = true end
	local distinct = 0
	for _ in pairs(kinds) do distinct = distinct + 1 end
	check("offers are distinct kinds", distinct == 3)

	-- skills: catalog and per-skill xp curve. No passives here any more --
	-- Haste/Summon Regen/Pierce moved to game.upgrades.
	check("cone range", near(skills.CONE_RANGE, math.sqrt(layout.SCREEN_W ^ 2 + layout.PLAY_H ^ 2)))
	check("dead again cooldown is halved", skills.SKILL_META.summon.cooldown == 6)
	check("dead again base stats lvl3", skills.ability1_stats(3).hp == 150 and skills.ability1_stats(3).damage == 30)
	check("dead again health curve", skills.ability1_stats(1).hp == 50 and skills.ability1_stats(4).hp == 200)
	check("the cure requires dead again", skills.SKILL_PARENT.seagull == "summon")
	check("monster zombie requires the cure", skills.SKILL_PARENT.monsterzombie == "seagull")
	check("fire enrage damage curve", skills.fireball_attack_damage(1) == 20 and skills.fireball_attack_damage(4) == 50)
	check("fire enrage duration", skills.FIREBALL_ENRAGE_DURATION == 10)
	check("chain lightning curve", skills.chain_lightning_hits(1) == 3 and skills.chain_lightning_hits(4) == 6
		and skills.chain_lightning_damage(1) == 25 and skills.chain_lightning_damage(4) == 100)
	check("chain lightning requires fireball", skills.SKILL_PARENT.chainlightning == "burn")
	check("shockwave requires fireball (swapped roots)", skills.SKILL_PARENT.cone == "burn")
	check("fireball is now a root", skills.SKILL_PARENT.burn == nil)
	check("sword throw curve", near(skills.sword_throw_percent(1), 2.5) and near(skills.sword_throw_percent(4), 4.0))
	check("sword throw requires berserker", skills.SKILL_PARENT.swordthrow == "ranged")
	check("stomp requires sword throw", skills.SKILL_PARENT.stomp == "swordthrow")
	check("drain life requires shockwave", skills.SKILL_PARENT.drainlife == "cone")
	check("burn flat damage lvl4", skills.burn_explode_damage(4) == 100)
	check("xp to next lvl1", skills.skill_xp_to_next(1) == 100)
	check("xp curve", skills.skill_xp_to_next(2) == 200 and skills.skill_xp_to_next(3) == 300)
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
	check("cone damage is flat", near(hits[1].amount, 10))

	-- meta defaults: every skill starts locked (level 0), no starting gold
	local dm = meta_mod.default_meta()
	local all_locked = true
	for _, sid in ipairs(skills.ALL_SKILLS) do
		if dm.skill_levels[sid] ~= 0 then all_locked = false end
	end
	check("every skill starts locked", all_locked)
	check("starts with 0 gold", dm.gold == 0)
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

	-- abilities built from loadout
	local ab = meta_mod.make_abilities({ "cone" }, { cone = 3 })
	check("ability slot 1", ab[1].skill == "cone" and ab[1].level == 3)
	check("ability slot 2 empty", ab[2].skill == nil and ab[2].level == 0)

	local opening_wave = sim.new(meta_mod.build_fresh_state(dm), { is_test_run = true })
	check("opening wave starts during entrance", opening_wave.player.intro_phase == "enter")
	sim.update(opening_wave, 1 / 60)
	check("wave one launches before entrance completes",
		opening_wave.wave == 1 and opening_wave.player.intro_phase ~= "done")

	-- sim: fresh state walks through the entrance and draws
	local gs = meta_mod.build_fresh_state(dm)
	local s = sim.new(gs, { run_id = "test", is_test_run = true, skill_levels = dm.skill_levels, skill_xp = dm.skill_xp })
	-- The default loadout is empty and skills start locked now, so equip the
	-- three roots at rank 1 explicitly for this end-to-end wave test.
	s.abilities = meta_mod.make_abilities({ "summon", "cone", "ranged" }, { summon = 1, cone = 1, ranged = 1 })
	s.wave_countdown = nil -- drive waves manually here, no auto-launch
	check("player starts entering", s.player.intro_phase == "enter")
	check("player enters from the top", s.player.pos.y < 0
		and near(s.player.pos.x, layout.SCREEN_W / 2)
		and near(s.player.target.x, layout.SCREEN_W / 2)
		and s.player.target.y > 0 and s.player.facing == 2)
	for _ = 1, 600 do sim.update(s, 1 / 60) end
	check("intro completes", s.player.intro_phase == "done")
	check("player inside field", s.player.pos.y < layout.PLAY_H)
	check("player entrance stops one third into field", near(s.player.pos.y, layout.PLAY_H / 3, 1))
	local saw_draw = false
	for _, ev in ipairs(sim.take_events(s)) do
		if ev.type == "sfx" and ev.name == "draw" then saw_draw = true end
	end
	check("draw sound fired", saw_draw)

	-- sim: wave spawns and clears; a non-boss wave hands out no upgrade choice
	sim.start_next_wave(s)
	check("wave counter", s.wave == 1)
	check("wave queued", #s.wave_queues == 1)
	-- This is a wave-lifecycle test, not an AI travel-time test. Mark each
	-- spawned enemy dead so it remains deterministic at every arena aspect.
	for _ = 1, 60 * 30 do
		sim.update(s, 1 / 60)
		for _, mob in ipairs(s.mobs) do mob.hp = 0 end
		sim.take_events(s)
		if s.highest_wave_cleared >= 1 then break end
	end
	check("wave 1 cleared", s.highest_wave_cleared == 1)
	check("player survived wave 1", s.player.hp > 0)
	check("no upgrade offer on a non-boss wave", #s.pending_upgrade_offers == 0)

	-- Clearing a map's last wave opens the drawn world map; walking to a place
	-- grants what that place holds.
	local routemap = require("game.routemap")
	-- The first place past the awakening heart: five waves wide, and the
	-- roads out of it fork again. The opening has its own block below.
	local past_heart
	for id, node in ipairs(routemap.nodes) do
		if node.stage == sim.OPENING_MAPS and not past_heart then past_heart = id end
	end
	local milestone = sim.new(meta_mod.build_fresh_state(dm), { is_test_run = true })
	milestone.player.intro_phase = "done"
	milestone.route_node = past_heart
	milestone.route_history = { past_heart }
	milestone.map_index = sim.OPENING_MAPS + 1
	milestone.wave = sim.map_last_wave(milestone.map_index)
	milestone.loot_owed = { milestone.wave }
	local milestone_wave = milestone.wave
	check("closing wave blocks the next", not sim.start_next_wave(milestone)
		and milestone.wave == milestone_wave)
	sim.update(milestone, 0.5)
	check("checkpoint opens route immediately", milestone.route_pending
		and #milestone.pending_upgrade_offers == 0 and milestone.upgrade_offer_timer == nil)
	local checkpoint_events, opening_flag = 0, nil
	for _, ev in ipairs(sim.take_events(milestone)) do
		if ev.type == "checkpoint_reward" and ev.wave == milestone_wave then
			checkpoint_events = checkpoint_events + 1
			opening_flag = ev.opening
		end
	end
	check("checkpoint reward emitted exactly once", checkpoint_events == 1)
	check("reward past the opening carries no opening flag", opening_flag == false)
	check("route blocks next map", not sim.can_start_next_wave(milestone))
	check("the road past the heart forks", sim.route_choice_count(milestone) >= 2)
	milestone.allies = { { id = 99 } }
	milestone.player.hp = 1
	milestone.abilities[1].cooldown = 9
	local upgrades_before_route = #milestone.upgrades
	local map_before_route = milestone.map_index
	local step_to = sim.route_choices(milestone)[1]
	check("walking a road advances the stage", sim.choose_route(milestone, step_to)
		and milestone.map_index == map_before_route + 1 and not milestone.route_pending
		and milestone.route_node == step_to)
	check("chosen map grants its upgrade", #milestone.upgrades == upgrades_before_route + 1)
	check("new map resets combat field", #milestone.allies == 0
		and milestone.player.hp == milestone.player.max_hp
		and milestone.abilities[1].cooldown == 0
		and milestone.player.intro_phase == "enter")
	check("completed map remains on its closing wave",
		milestone.wave == sim.map_last_wave(map_before_route))
	milestone.wave_countdown = nil
	check("new map can launch", sim.start_next_wave(milestone)
		and milestone.wave == milestone_wave + 1 and sim.local_wave(milestone) == 1)
	-- Only roads that exist may be walked, and only forward ones.
	local edge = sim.new(meta_mod.build_fresh_state(dm), { is_test_run = true })
	edge.route_node = past_heart
	edge.map_index = sim.OPENING_MAPS + 1
	edge.route_pending = true
	local reachable_here = {}
	for _, c in ipairs(sim.route_choices(edge)) do reachable_here[c] = true end
	local unreachable
	for id = 1, #routemap.nodes do
		if not reachable_here[id] and id ~= past_heart and not unreachable then unreachable = id end
	end
	check("a place with no road from here cannot be walked to",
		not sim.choose_route(edge, unreachable))
	check("the drawn world ends where the drawing does",
		not sim.route_has_next({ route_node = #routemap.nodes }))

	-- The opening: stage 0 is a doorstep, stages 1-3 are three short maps in
	-- a single file, and they pay gold and gear only.
	check("stage zero has no waves", sim.waves_in_map(1) == 0)
	check("opening stages are three waves", sim.waves_in_map(2) == 3
		and sim.waves_in_map(sim.OPENING_MAPS) == 3)
	check("maps after the opening are five waves",
		sim.waves_in_map(sim.OPENING_MAPS + 1) == sim.UPGRADE_EVERY_WAVES)
	check("stage one closes on wave three", sim.map_last_wave(2) == 3)
	check("the heart is won on wave nine", sim.map_last_wave(sim.OPENING_MAPS) == 9)
	check("stage numbering trails the map by one", sim.stage_of_map(1) == 0
		and sim.stage_of_map(sim.OPENING_MAPS) == 3)

	-- A fresh run opens standing on stage 0 with a step owed: pressing the
	-- next stage is what starts the fighting.
	local opening = sim.new(meta_mod.build_fresh_state(dm), { is_test_run = true })
	opening.player.intro_phase = "done"
	opening.route_pending = true
	check("the run opens on stage zero", opening.map_index == 1 and opening.wave == 0)
	check("nothing launches while the road is up", not sim.can_start_next_wave(opening))
	check("opening road is single file", sim.route_choice_count(opening) == 1)
	local upgrades_before_opening = #opening.upgrades
	check("pressing stage one sets out",
		sim.choose_route(opening, sim.route_choices(opening)[1]) and opening.map_index == 2)
	check("setting out grants no upgrade card",
		#opening.upgrades == upgrades_before_opening)
	opening.wave_countdown = nil
	check("stage one starts at its own first wave", sim.start_next_wave(opening)
		and opening.wave == 1 and sim.local_wave(opening) == 1)

	opening.loot_owed = { 3 }
	opening.wave = 3
	check("third wave closes stage one", not sim.start_next_wave(opening)
		and opening.wave == 3)
	sim.update(opening, 0.5)
	local opening_flagged = false
	for _, ev in ipairs(sim.take_events(opening)) do
		if ev.type == "checkpoint_reward" and ev.wave == 3 then
			opening_flagged = ev.opening == true
		end
	end
	check("opening checkpoint says it is the opening", opening_flagged)

	-- Past the heart the road opens up again and pays cards as before.
	local awakened = sim.new(meta_mod.build_fresh_state(dm), { is_test_run = true })
	awakened.route_node = 4
	awakened.route_history = { 4 }
	awakened.map_index = sim.OPENING_MAPS
	awakened.route_pending = true
	check("the heart offers three ways on", sim.route_choice_count(awakened) == 3)
	local cards_before = #awakened.upgrades
	check("stepping past the heart advances",
		sim.choose_route(awakened, sim.route_choices(awakened)[1]))
	check("the first map past the heart pays a card",
		#awakened.upgrades == cards_before + 1)

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
	check("move accepted once answered", s.player.target ~= nil
		and s.player.target.x == combat.PLAYER_RADIUS)
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
	check("player has configured health regen per second",
		near(s10.player.hp, 100 + combat.PLAYER_HEALTH_REGEN))
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
	check("wave clear does not heal to full",
		near(no_clear_heal.player.hp, 50 + combat.PLAYER_HEALTH_REGEN))

	-- sim: enemies enter from the right, outside the top exclusion zone, and
	-- march left until a target enters their detection range.
	local ranged_exit = sim.new(meta_mod.build_fresh_state(dm), { is_test_run = true })
	ranged_exit.player.intro_phase = "done"
	ranged_exit.player.pos = { x = combat.PLAYER_RADIUS, y = layout.PLAY_H - combat.PLAYER_RADIUS }
	local top_ranged = combat.spawn_mob("ranged", 1)
	ranged_exit.mobs = { top_ranged }
	local spawn_x, spawn_y = top_ranged.pos.x, top_ranged.pos.y
	sim.update(ranged_exit, 0.1)
	check("mob spawns at right edge", spawn_x > layout.SCREEN_W - 40)
	check("mob starts fully offscreen", spawn_x > layout.SCREEN_W + top_ranged.radius)
	check("mob spawns below top buffer",
		spawn_y >= top_ranged.radius + combat.PLAYER_TOP_BUFFER)
	check("ranged mob marches left before attacking",
		top_ranged.pos.x < spawn_x and near(top_ranged.pos.y, spawn_y)
		and #ranged_exit.projectiles == 0)
	local left_ranged_state = sim.new(meta_mod.build_fresh_state(dm), { is_test_run = true })
	left_ranged_state.player.intro_phase = "done"
	left_ranged_state.player.pos = { x = layout.SCREEN_W - combat.PLAYER_RADIUS,
		y = layout.PLAY_H - combat.PLAYER_RADIUS }
	local left_ranged = combat.spawn_mob("ranged", 1, "left")
	left_ranged_state.mobs = { left_ranged }
	local left_spawn_x = left_ranged.pos.x
	sim.update(left_ranged_state, 0.1)
	check("left-side ranged mob marches right toward middle",
		left_ranged.pos.x > left_spawn_x and #left_ranged_state.projectiles == 0)
	local gated_ranged = combat.spawn_mob("ranged", 1, "right")
	gated_ranged.pos.y = ranged_exit.player.pos.y
	ranged_exit.player.pos = { x = layout.SCREEN_W - 20, y = gated_ranged.pos.y }
	ranged_exit.mobs = { gated_ranged }
	sim.update(ranged_exit, 1 / 60)
	check("offscreen ranged mob cannot attack", #ranged_exit.projectiles == 0)
	gated_ranged.pos.x = layout.SCREEN_W - gated_ranged.radius - 1
	gated_ranged.attack_cooldown = 0
	sim.update(ranged_exit, 1 / 60)
	check("ranged attack enables inside gameplay area", #ranged_exit.projectiles == 1)

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
	local chain_damage = skills.chain_lightning_damage(1)
	check("chain lightning hits configured count", near(chain_state.mobs[1].hp, 1000 - chain_damage)
		and near(chain_state.mobs[2].hp, 1000 - chain_damage * skills.CHAIN_LIGHTNING_FALLOFF)
		and near(chain_state.mobs[3].hp, 1000 - chain_damage * skills.CHAIN_LIGHTNING_FALLOFF ^ 2)
		and near(chain_state.mobs[4].hp, 1000))
	check("chain lightning creates one visual link per hit", #chain_state.lightning_links == 3)

	local chain_range = sim.new(meta_mod.build_fresh_state(dm), { is_test_run = true })
	chain_range.player.intro_phase = "done"
	chain_range.abilities = { { skill = "chainlightning", level = 4, cooldown = 0 }, { skill = nil, level = 0, cooldown = 0 }, { skill = nil, level = 0, cooldown = 0 } }
	local chain_first = combat.spawn_mob("melee", 1)
	chain_first.pos = { x = chain_range.player.pos.x + 30, y = chain_range.player.pos.y }
	chain_first.hp, chain_first.max_hp = 1000, 1000
	local chain_far = combat.spawn_mob("melee", 1)
	chain_far.pos = { x = chain_first.pos.x + skills.CHAIN_LIGHTNING_JUMP_RANGE + chain_far.radius + 10, y = chain_first.pos.y }
	chain_far.hp, chain_far.max_hp = 1000, 1000
	chain_range.mobs = { chain_first, chain_far }
	sim.press_ability(chain_range, 1)
	check("chain lightning respects jump range", chain_first.hp < 1000 and chain_far.hp == 1000)

	local chain_out = sim.new(meta_mod.build_fresh_state(dm), { is_test_run = true })
	chain_out.player.intro_phase = "done"
	chain_out.abilities = { { skill = "chainlightning", level = 1, cooldown = 0 }, { skill = nil, level = 0, cooldown = 0 }, { skill = nil, level = 0, cooldown = 0 } }
	local out_target = combat.spawn_mob("melee", 1)
	out_target.pos = { x = chain_out.player.pos.x + skills.CHAIN_LIGHTNING_CAST_RANGE + out_target.radius + 10, y = chain_out.player.pos.y }
	chain_out.mobs = { out_target }
	sim.press_ability(chain_out, 1)
	check("chain lightning respects cast range",
		#chain_out.lightning_links == 0 and chain_out.abilities[1].cooldown == 0)

	-- sim: a lethal Sword Throw bounces to another target in range, in the
	-- same throw, rather than being recast -- the cooldown is untouched.
	local sword_state = sim.new(meta_mod.build_fresh_state(dm), { is_test_run = true })
	sword_state.player.intro_phase = "done"
	sword_state.player.target = nil
	sword_state.abilities = { { skill = "swordthrow", level = 1, cooldown = 0 }, { skill = nil, level = 0, cooldown = 0 }, { skill = nil, level = 0, cooldown = 0 } }
	local sword_target = combat.spawn_mob("melee", 1)
	sword_target.pos = { x = sword_state.player.pos.x + 200, y = sword_state.player.pos.y }
	sword_target.hp, sword_target.max_hp, sword_target.damage = 10, 10, 0
	local sword_next = combat.spawn_mob("melee", 1)
	sword_next.pos = { x = sword_state.player.pos.x + 260, y = sword_state.player.pos.y }
	sword_next.hp, sword_next.max_hp, sword_next.damage = 1000, 1000, 0
	sword_state.mobs = { sword_target, sword_next }
	sim.press_ability(sword_state, 1)
	local sword_cooldown_after_cast = sword_state.abilities[1].cooldown
	check("sword throw starts cooldown", sword_cooldown_after_cast > 0)
	for _ = 1, 60 do sim.update(sword_state, 1 / 60) end
	check("lethal sword throw bounces to the next opponent", sword_next.hp < sword_next.max_hp)
	check("bouncing does not touch the ability's own cooldown",
		near(sword_state.abilities[1].cooldown, math.max(0, sword_cooldown_after_cast - 1)))
	local far_sword_state = sim.new(meta_mod.build_fresh_state(dm), { is_test_run = true })
	far_sword_state.player.intro_phase = "done"
	far_sword_state.abilities = { { skill = "swordthrow", level = 1, cooldown = 0 }, { skill = nil, level = 0, cooldown = 0 }, { skill = nil, level = 0, cooldown = 0 } }
	local far_sword_target = combat.spawn_mob("melee", 1)
	far_sword_target.pos = { x = far_sword_state.player.pos.x + skills.SWORD_THROW_RANGE + far_sword_target.radius + 10, y = far_sword_state.player.pos.y }
	far_sword_state.mobs = { far_sword_target }
	sim.press_ability(far_sword_state, 1)
	check("sword throw respects maximum range",
		#far_sword_state.projectiles == 0 and far_sword_state.abilities[1].cooldown == 0)

	local left_spawn = combat.spawn_mob("melee", 1, "left")
	local right_spawn = combat.spawn_mob("melee", 1, "right")
	check("waves can enter from both sides", left_spawn.pos.x < 100 and right_spawn.pos.x > 700)
	check("higher-rank summons attack faster",
		combat.ally_attack_cooldown(4) < combat.ally_attack_cooldown(1))

	-- Dead Again resummons the oldest corpse in range as a weaker, timed
	-- zombie -- consuming the corpse. No corpse in range, no cast.
	local summon_state = sim.new(meta_mod.build_fresh_state(dm), { is_test_run = true })
	summon_state.player.intro_phase = "done"
	summon_state.abilities = { { skill = "summon", level = 1, cooldown = 0 }, { skill = nil, level = 0, cooldown = 0 }, { skill = nil, level = 0, cooldown = 0 } }
	sim.press_ability(summon_state, 1)
	check("dead again does nothing without a corpse in range", #summon_state.allies == 0
		and summon_state.abilities[1].cooldown == 0)
	summon_state.zombie_corpses = {
		{ id = 1, pos = { x = summon_state.player.pos.x + 5, y = summon_state.player.pos.y }, age = 3 },
		{ id = 2, pos = { x = summon_state.player.pos.x + 8, y = summon_state.player.pos.y }, age = 6 },
	}
	sim.press_ability(summon_state, 1)
	check("dead again consumes the oldest corpse in range", #summon_state.zombie_corpses == 1
		and summon_state.zombie_corpses[1].id == 1)
	check("dead again spawns one ally at half the base stats",
		#summon_state.allies == 1
			and summon_state.allies[1].hp == math.floor(skills.ability1_stats(1).hp / 2)
			and near(summon_state.allies[1].damage, skills.ability1_stats(1).damage / 2))
	check("dead again's zombie expires after its own duration", summon_state.allies[1].expire_timer == skills.DEAD_AGAIN_DURATION)
	local far_summon_state = sim.new(meta_mod.build_fresh_state(dm), { is_test_run = true })
	far_summon_state.player.intro_phase = "done"
	far_summon_state.abilities = { { skill = "summon", level = 1, cooldown = 0 }, { skill = nil, level = 0, cooldown = 0 }, { skill = nil, level = 0, cooldown = 0 } }
	far_summon_state.zombie_corpses = {
		{ id = 1, pos = { x = far_summon_state.player.pos.x + skills.DEAD_AGAIN_RANGE + 50, y = far_summon_state.player.pos.y }, age = 1 },
	}
	sim.press_ability(far_summon_state, 1)
	check("dead again respects its maximum range", #far_summon_state.allies == 0
		and #far_summon_state.zombie_corpses == 1)
	local expiring_ally = summon_state.allies[1]
	expiring_ally.expire_timer = 0.05
	sim.update(summon_state, 0.1)
	check("an expired summon is removed", #summon_state.allies == 0)

	local objective_state = sim.new(meta_mod.build_fresh_state(dm), { is_test_run = true })
	objective_state.player.intro_phase = "done"
	objective_state.player.pos = { x = 20, y = 20 }
	local objective_mob = combat.spawn_mob("melee", 1)
	objective_mob.damage = 7
	objective_mob.pos = { x = objective_state.girl.pos.x + 20, y = objective_state.girl.pos.y }
	objective_state.mobs = { objective_mob }
	sim.update(objective_state, 1 / 60)
	check("undefended girl is attacked", objective_state.girl.hp == 93)
	check("mob cannot overlap girl", combat.dist(objective_mob.pos, objective_state.girl.pos)
		>= objective_mob.radius + objective_state.girl.radius - 0.01)

	-- sim: Fireball throws a projectile at the nearest enemy that explodes on
	-- impact, damaging everyone nearby -- including the target itself.
	local s3 = sim.new(meta_mod.build_fresh_state(dm), { is_test_run = true })
	s3.player.intro_phase = "done"
	s3.player.target = nil
	s3.player.pos = { x = 45, y = 50 }
	local a = combat.spawn_mob("melee", 1)
	local b = combat.spawn_mob("melee", 1)
	a.pos = { x = 50, y = 50 } -- nearest to the player
	b.pos = { x = 90, y = 50 } -- inside BURN_EXPLODE_RADIUS of a
	a.hp, a.max_hp = 10, 10
	b.hp, b.max_hp = 200, 200
	s3.mobs = { a, b }
	s3.abilities = { { skill = "burn", level = 4, cooldown = 0 }, { skill = nil, level = 0, cooldown = 0 }, { skill = nil, level = 0, cooldown = 0 } }
	sim.press_ability(s3, 1)
	check("fireball launches a projectile at the nearest enemy", #s3.projectiles == 1)
	for _ = 1, 60 do sim.update(s3, 1 / 60) end
	check("fireball explosion damaged the neighbour by a flat amount", b.hp <= 100)
	check("fireball explosion creates a range-matched blast", #s3.explosions >= 1
		and near(s3.explosions[1].radius, skills.BURN_EXPLODE_RADIUS))

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
	local far_push = combat.spawn_mob("melee", 1)
	far_push.pos = { x = s4.player.pos.x + skills.PUSH_RANGE + far_push.radius + 10, y = s4.player.pos.y }
	s4.mobs = { far_push }
	s4.abilities[1].cooldown = 0
	sim.press_ability(s4, 1)
	check("push has a maximum range", far_push.hp == far_push.max_hp and far_push.knock.x == 0)

	-- sim: Stomp stuns and damages everyone nearby; a stunned mob does not
	-- advance or attack until the stun wears off.
	local stomp_state = sim.new(meta_mod.build_fresh_state(dm), { is_test_run = true })
	stomp_state.player.intro_phase = "done"
	stomp_state.player.target = nil
	stomp_state.abilities = { { skill = "stomp", level = 1, cooldown = 0 }, { skill = nil, level = 0, cooldown = 0 }, { skill = nil, level = 0, cooldown = 0 } }
	local stomp_mob = combat.spawn_mob("melee", 1)
	stomp_mob.pos = { x = stomp_state.player.pos.x + 30, y = stomp_state.player.pos.y }
	stomp_mob.hp, stomp_mob.max_hp = 1000, 1000
	stomp_state.mobs = { stomp_mob }
	sim.press_ability(stomp_state, 1)
	check("stomp damages nearby enemies", stomp_mob.hp < 1000)
	check("stomp stuns nearby enemies", stomp_mob.stun_timer == skills.STOMP_STUN_DURATION)
	local stomp_pos_before = { x = stomp_mob.pos.x, y = stomp_mob.pos.y }
	sim.update(stomp_state, 1 / 60)
	check("a stunned mob does not move", near(stomp_mob.pos.x, stomp_pos_before.x) and near(stomp_mob.pos.y, stomp_pos_before.y))

	-- sim: Drain Life channels, saps nearby enemies into the player's own
	-- health, and is broken by moving or casting another skill.
	local drain_state = sim.new(meta_mod.build_fresh_state(dm), { is_test_run = true })
	drain_state.player.intro_phase = "done"
	drain_state.player.target = nil
	drain_state.player.max_hp = 200
	drain_state.player.hp = 100
	drain_state.abilities = { { skill = "drainlife", level = 1, cooldown = 0 }, { skill = "push", level = 1, cooldown = 0 }, { skill = nil, level = 0, cooldown = 0 } }
	local drain_mob = combat.spawn_mob("melee", 1)
	drain_mob.pos = { x = drain_state.player.pos.x + 30, y = drain_state.player.pos.y }
	drain_mob.hp, drain_mob.max_hp, drain_mob.damage = 1000, 1000, 0
	drain_state.mobs = { drain_mob }
	sim.press_ability(drain_state, 1)
	check("drain life starts a channel", drain_state.drain_channel ~= nil)
	sim.update(drain_state, 1 / 60)
	check("drain life damages nearby enemies", drain_mob.hp < 1000)
	check("drain life heals the player", drain_state.player.hp > 100)
	check("drain life draws a link to the enemy it's sapping", #drain_state.drain_links == 1)
	drain_state.player.target = { x = drain_state.player.pos.x + 100, y = drain_state.player.pos.y }
	sim.update(drain_state, 1 / 60)
	check("moving breaks the drain life channel", drain_state.drain_channel == nil and #drain_state.drain_links == 0)
	drain_state.abilities[1].cooldown = 0
	sim.press_ability(drain_state, 1)
	drain_state.player.target = nil
	check("drain life restarted", drain_state.drain_channel ~= nil)
	sim.press_ability(drain_state, 2)
	check("casting another skill breaks the drain life channel", drain_state.drain_channel == nil)

	-- sim: The Cure charms a non-boss mob to fight for the player.
	local cure_state = sim.new(meta_mod.build_fresh_state(dm), { is_test_run = true })
	cure_state.player.intro_phase = "done"
	cure_state.player.target = nil
	cure_state.abilities = { { skill = "seagull", level = 1, cooldown = 0 }, { skill = nil, level = 0, cooldown = 0 }, { skill = nil, level = 0, cooldown = 0 } }
	local cure_boss = combat.spawn_mob("boss", 1)
	cure_boss.pos = { x = cure_state.player.pos.x + 20, y = cure_state.player.pos.y }
	local cure_mob = combat.spawn_mob("melee", 1)
	cure_mob.pos = { x = cure_state.player.pos.x + 40, y = cure_state.player.pos.y }
	cure_mob.hp, cure_mob.max_hp, cure_mob.damage = 42, 42, 5
	cure_state.mobs = { cure_boss, cure_mob }
	sim.press_ability(cure_state, 1)
	check("the cure ignores bosses", #cure_state.mobs == 1 and cure_state.mobs[1] == cure_boss)
	check("the cure charms the nearest non-boss mob", #cure_state.allies == 1
		and cure_state.allies[1].hp == 42 and cure_state.allies[1].damage == 5)
	check("the charmed unit expires after the cure's duration",
		cure_state.allies[1].expire_timer == skills.CURE_DURATION)

	-- sim: Monster Zombie fuses every Dead Again zombie's current HP and
	-- attack damage into one, briefly.
	local mz_state = sim.new(meta_mod.build_fresh_state(dm), { is_test_run = true })
	mz_state.player.intro_phase = "done"
	mz_state.player.target = nil
	mz_state.abilities = { { skill = "monsterzombie", level = 1, cooldown = 0 }, { skill = nil, level = 0, cooldown = 0 }, { skill = nil, level = 0, cooldown = 0 } }
	mz_state.allies = {
		combat.make_custom_ally(mz_state.player.pos, { hp = 30, damage = 4, source_skill = "summon" }),
		combat.make_custom_ally(mz_state.player.pos, { hp = 20, damage = 6, source_skill = "summon" }),
		combat.make_custom_ally(mz_state.player.pos, { hp = 99, damage = 1, source_skill = "seagull" }),
	}
	sim.press_ability(mz_state, 1)
	check("monster zombie fuses only dead again zombies", #mz_state.allies == 2)
	local fused
	for _, ally in ipairs(mz_state.allies) do
		if ally.source_skill == "summon" then fused = ally end
	end
	check("monster zombie sums hp and damage", fused ~= nil and fused.hp == 50 and fused.damage == 10)
	check("monster zombie's fusion expires after its own duration", fused.expire_timer == skills.MONSTER_ZOMBIE_DURATION)

	-- sim: Fire Enrage keeps a borrowed-time summon from expiring while active.
	local enrage_state = sim.new(meta_mod.build_fresh_state(dm), { is_test_run = true })
	enrage_state.player.intro_phase = "done"
	enrage_state.player.target = nil
	enrage_state.abilities = { { skill = "fireball", level = 1, cooldown = 0 }, { skill = nil, level = 0, cooldown = 0 }, { skill = nil, level = 0, cooldown = 0 } }
	local timed_ally = combat.make_custom_ally(enrage_state.player.pos, { hp = 10, damage = 1, source_skill = "summon", expire_timer = 0.05 })
	enrage_state.allies = { timed_ally }
	sim.press_ability(enrage_state, 1)
	sim.update(enrage_state, 0.1)
	check("fire enrage keeps an enraged summon from expiring", #enrage_state.allies == 1
		and near(timed_ally.expire_timer, 0.05))

	local held_autostart = sim.new(meta_mod.build_fresh_state(dm), { is_test_run = true })
	held_autostart.player.intro_phase = "done"
	held_autostart.wave_countdown = 0
	local blocker = combat.spawn_mob("melee", 1)
	blocker.damage = 0
	held_autostart.mobs = { blocker }
	sim.update(held_autostart, 1 / 60)
	check("auto-start waits for an empty enemy field", held_autostart.wave == 0)

	-- sim: no mana anywhere -- abilities are cooldown-gated only
	local s4b = sim.new(meta_mod.build_fresh_state(dm), { is_test_run = true })
	check("player state has no mana field", s4b.player.mana == nil)
	check("player state has no level/xp fields", s4b.player.level == nil and s4b.player.xp == nil)

	-- save/load roundtrip uses isolated in-memory storage. Tests must never
	-- overwrite the player's real debug-build progression.
	meta_mod.set_test_storage({})
	local test_meta = meta_mod.default_meta()
	test_meta.gold = 77
	test_meta.skill_levels.summon = 3
	test_meta.skill_xp.summon = 42
	meta_mod.persist_meta(test_meta)
	local loaded = meta_mod.load_meta()
	check("meta roundtrip gold", loaded.gold == 77)
	check("meta roundtrip skill level", loaded.skill_levels.summon == 3)
	check("meta roundtrip skill xp", loaded.skill_xp.summon == 42)

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
	meta_mod.set_test_storage(nil)

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

	-- Normal wave clears do not move the safe restore point. Saving happens
	-- only after entering a new map.
	local s6 = sim.new(meta_mod.build_fresh_state(dm), { run_id = "r-save", is_test_run = false })
	s6.player.intro_phase = "done"
	s6.player.target = nil
	s6.player.max_hp = 100000
	s6.player.hp = 100000
	sim.start_next_wave(s6)
	local saw_save = nil
	for _ = 1, 60 * 30 do
		sim.update(s6, 1 / 60)
		for _, mob in ipairs(s6.mobs) do mob.hp = 0 end
		for _, ev in ipairs(sim.take_events(s6)) do
			if ev.type == "autosave" then saw_save = ev.save end
		end
		if s6.highest_wave_cleared >= 1 then break end
	end
	check("ordinary wave clear does not autosave", saw_save == nil)

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

	-- Run-specific progression is saved with an unfinished run and is fully
	-- discarded when that run ends.
	meta_mod.set_test_storage({})
	session.saved_runs = {}
	session.current_run_id = "run-progress-test"
	session.run_active = true
	session.is_test_run = false
	session.meta = session.new_run_meta()
	session.sim = sim.new(meta_mod.build_fresh_state(session.meta), {
		run_id = session.current_run_id,
		skill_levels = session.meta.skill_levels,
		skill_xp = session.meta.skill_xp,
		equipment = session.meta.equipment,
	})
	session.store_run(sim.make_save(session.sim))
	session.meta.skill_levels.summon = 1
	session.meta.skill_xp.summon = 7
	session.meta.loadout = { "summon" }
	session.commit_meta(session.meta)
	session.sync_run_abilities()
	check("skill choice syncs complete live state",
		session.sim.abilities[1].skill == "summon"
			and session.sim.skill_levels.summon == 1
			and session.sim.skill_xp.summon == 7)
	session.grant_checkpoint_reward(5)
	check("checkpoint grants only configured currency",
		session.meta.gold == 10 and session.meta.skill_points == 2)
	check("map-start snapshot is not mutated during map",
		not session.saved_runs[1].checkpoint_reward_open
			and session.saved_runs[1].reward_item == nil
			and session.saved_runs[1].run_meta.gold == 0)
	local offered_item = session.reward_item
	session.equip_reward()
	local expected_gear = inventory.bonuses(session.meta.equipment)
	check("equipped checkpoint item updates live gear",
		offered_item ~= nil and session.reward_item == nil
			and near(session.sim.gear_bonus.max_health, expected_gear.max_health)
			and near(session.sim.gear_bonus.attack_damage, expected_gear.attack_damage))
	session.store_run(sim.make_save(session.sim))
	local saved_progress = session.saved_runs[1]
	check("next map snapshot captures run progression",
		saved_progress.run_meta.gold == 10
			and saved_progress.run_meta.skill_levels.summon == 1)
	session.meta.gold = 999
	check("stored map snapshot is isolated from live tables",
		saved_progress.run_meta.gold == 10)
	session.store_run({
		id = "replacement-save", wave = 5, saved_at = os.time(),
		abilities = {}, upgrades = {}, route_history = {}, route_grid = {},
	})
	check("storing a map keeps exactly one save",
		#session.saved_runs == 1 and session.saved_runs[1].id == "replacement-save")
	saved_progress = session.saved_runs[1]
	session.discard_run_progress()
	check("ending run resets all progression",
		session.meta.gold == 0 and session.meta.skill_points == 1
			and #session.meta.loadout == 0 and next(session.meta.equipment) == nil)
	session.restore_run_progress(saved_progress)
	check("continue restores run progression",
		session.meta.gold == 999 and session.meta.skill_levels.summon == 1
			and session.meta.loadout[1] == "summon")
	session.sim = nil
	session.current_run_id = nil
	session.discard_run_progress()
	session.saved_runs = {}
	meta_mod.set_test_storage(nil)

	print(("PORT TESTS: %d passed, %d failed"):format(passed, failed))
	return failed == 0
end

return M
