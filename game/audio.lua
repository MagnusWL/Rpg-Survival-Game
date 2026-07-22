-- Audio dispatch: pools, no-repeat picks and puddle-aware footsteps, ported
-- from App.tsx's sound handling. All clips live as components on main:/sounds.
local session = require("game.session")

local M = {}

local last_footstep = -1
local last_armour = -1

local function url_for(name)
	return msg.url("main", "/sounds", name)
end

-- Fire and forget. Audio is a garnish -- it must never break the game loop.
function M.play(name)
	if session.sfx_off or session.all_sound_off then return end
	pcall(sound.play, url_for(name))
end

-- Sim event names arrive as "attack-1" style; components use underscores.
function M.play_sfx_event(name)
	if name == "hurt" then
		M.play("hurt_1")
	else
		M.play((name:gsub("-", "_")))
	end
end

-- One press, all four pieces struck together.
function M.menu_press()
	for i = 1, 4 do M.play("menu_press_" .. i) end
end

-- Wet or dry decided per step; the same take never lands twice running, and
-- the armour rattle is drawn separately so the two vary independently.
function M.footstep(in_water)
	local pool = in_water and "puddle_" or "footstep_"
	local pick = math.random(0, 5)
	if pick == last_footstep then pick = (pick + 1) % 6 end
	last_footstep = pick
	M.play(pool .. (pick + 1))
	local rattle = math.random(0, 10)
	if rattle == last_armour then rattle = (rattle + 1) % 11 end
	last_armour = rattle
	M.play("armour_" .. (rattle + 1))
end

-- Music: one track for the menu, another in a run, rain under the game track.
local playing = {}

local function set_track(name, should_play)
	if should_play and not playing[name] then
		playing[name] = true
		pcall(sound.play, url_for(name))
	elseif not should_play and playing[name] then
		playing[name] = nil
		pcall(sound.stop, url_for(name))
	end
end

function M.refresh_music()
	local music_ok = not (session.music_off or session.all_sound_off)
	local in_game = session.screen == "game"
	set_track("music_menu", music_ok and not in_game)
	set_track("music_game", music_ok and in_game)
	set_track("music_rain", in_game and not session.all_sound_off and not session.weather_off)
end

return M
