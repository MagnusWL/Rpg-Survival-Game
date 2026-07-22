-- vines.lua — CRUEL blood-vine engine, Defold port (skeleton)
-- Port af strand-simulationen fra CRUEL-Skill-Tree-Blomst (JS: _desired/step/drawStrand).
-- Render-idé: hver strand tegnes som grid-snappede kvadrater ("blokke") langs en
-- quadratic bezier — i Defold = en pool af små box-gui-nodes (eller sprites) med én
-- hvid pixel-textur, farvet med gui.set_color. GRID=1.5 ækvivalent: brug blokke på
-- 2-3 px i jeres design-opløsning og snap positionerne.

local M = {}

-- ===== farve-hjælpere (JS: shade/mix/palMix) =====
local function clamp01(t) return math.max(0, math.min(1, t)) end

local function shade(c, amt) -- c = {r,g,b} 0..1
  local f = function(v)
    if amt >= 0 then return v + (1 - v) * amt else return v * (1 + amt) end
  end
  return { f(c[1]), f(c[2]), f(c[3]) }
end

local function mix(a, b, t)
  return { a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t, a[3]+(b[3]-a[3])*t }
end

-- palet ud fra én basisfarve (JS: palMix) — off/lit blandes med litCur før kald
function M.palette(base)
  return {
    edge  = shade(base, -0.72), -- mørk kant
    body  = base,               -- krop
    deep2 = shade(base, -0.30), -- mørk spids-del
    wet   = shade(base,  0.30), -- vådt højlys
    node  = shade(base,  0.42), -- knude ved hovedet
    flash = shade(base,  0.72), -- lys prik på hovedet
  }
end

-- ===== easing =====
local function ease_out_cubic(t) return 1 - (1 - t)^3 end

-- ===== strand-tilstand =====
-- def = { key, ax,ay, bx,by, seed, delay(ms), dur(ms), thick, sag, lit, after }
-- after = key på forudgående strand (kæde-gating); nil = ingen gate.

M.strands = {}   -- key -> strand
M.drips   = {}   -- aktive dryp

function M.desired_sync(desired, now)
  local seen = {}
  for _, d in ipairs(desired) do
    seen[d.key] = true
    local s = M.strands[d.key]
    if not s then
      s = {}
      for k, v in pairs(d) do s[k] = v end
      s.born, s.grow, s.dying = now, 0, false
      s.thick_cur = d.thick * (d.lit and 1.6 or 0.4)
      s.ph = d.seed or 0          -- sway-fase (fryser når slukket)
      s.lit_cur = d.lit and 1 or 0
      s.fast = d.fast or false    -- equip-regrow: lineær, ingen gate
      M.strands[d.key] = s
    else
      local kk = 1 - math.exp(-M.dt_ms / 200) -- elastisk følgning (dt sat i update)
      s.ax = s.ax + (d.ax - s.ax) * kk
      s.ay = s.ay + (d.ay - s.ay) * kk
      s.bx = s.bx + (d.bx - s.bx) * kk
      s.by = s.by + (d.by - s.by) * kk
      s.sag, s.thick, s.lit, s.after = d.sag, d.thick, d.lit, d.after
      local tt = d.thick * (d.lit and 1.6 or 0.4)
      s.thick_cur = s.thick_cur + (tt - s.thick_cur) * kk
      if s.lit then s.ph = s.ph + M.dt_ms * 0.0009 end     -- sway kun når tændt
      local lt = d.lit and 1 or 0
      s.lit_cur = s.lit_cur + (lt - s.lit_cur) * kk        -- farve/hæng-fade
      if s.dying then s.dying = false; s.fast = true end   -- genoptag flydende
    end
  end
  for key, s in pairs(M.strands) do
    if not seen[key] then s.dying = true end
  end
end

function M.update(now, dt_ms)
  M.dt_ms = dt_ms
  for key, s in pairs(M.strands) do
    if s.dying then
      s.grow = s.grow - dt_ms / 360                 -- retract, lineær
      if s.grow <= 0 then M.strands[key] = nil end
    elseif s.fast then
      s.grow = math.min(1, s.grow + dt_ms / 380)    -- equip-regrow, lineær
    else
      local pre = s.after and M.strands[s.after] or nil
      if pre and pre.grow < 0.8 then
        s.born = now - (s.delay or 0)               -- vent på forrige led
        s.grow = 0
      else
        local age = now - s.born - (s.delay or 0)
        s.grow = age <= 0 and 0 or ease_out_cubic(clamp01(age / (s.dur or 900)))
      end
    end
    -- dryp: kun tændte, fuldt udvoksede strands
    if not s.dying and s.lit and s.grow > 0.96 and math.random() < dt_ms/1000 * 0.55 then
      local t = 0.28 + math.random() * 0.5
      local px, py = M.bez_point(s, t)
      table.insert(M.drips, { x = px, y = py, vy = 0, age = 0,
                              life = 1.4 + math.random()*1.4, hang = 2 + math.random()*3 })
    end
  end
  for i = #M.drips, 1, -1 do
    local d = M.drips[i]
    d.age = d.age + dt_ms / 1000
    if d.age < 0.75 then d.hang = d.hang + dt_ms * 0.02
    else d.vy = d.vy + 560 * dt_ms/1000; d.y = d.y + d.vy * dt_ms/1000 end
    if d.age > d.life then table.remove(M.drips, i) end
  end
end

-- kontrolpunkt: hæng + sway (JS: ctrlOf)
function M.ctrl(s)
  local dx, dy = s.bx - s.ax, s.by - s.ay
  local dist = math.max(1, math.sqrt(dx*dx + dy*dy))
  local px, py = -dy/dist, dx/dist
  local lc = s.lit_cur or 0
  local sway = math.sin(s.ph or 0) * 5
  local sag = (s.sag or 12) * (1 + 0.9*lc) + sway
  return (s.ax+s.bx)/2 + px*sag, (s.ay+s.by)/2 + py*sag + (12 + 16*lc)
end

function M.bez_point(s, t)
  local cx, cy = M.ctrl(s)
  local m = 1 - t
  return m*m*s.ax + 2*m*t*cx + t*t*s.bx,
         m*m*s.ay + 2*m*t*cy + t*t*s.by
end

-- ===== render: blokke langs kurven (JS: drawStrand) =====
-- emit(x, y, size, color, alpha) — callbacken placerer/farver en pool-node.
-- GRID: snap x,y til grid. off_col/lit_col = {r,g,b}.
function M.render(emit, GRID, off_col, lit_col)
  for _, s in pairs(M.strands) do
    local pal = M.palette(mix(off_col, lit_col, clamp01(s.lit_cur or 0)))
    local dx, dy = s.bx - s.ax, s.by - s.ay
    local dist = math.max(1, math.sqrt(dx*dx + dy*dy))
    local px, py = -dy/dist, dx/dist
    local head = clamp01(s.grow)
    local segs = math.max(22, math.floor(dist / (GRID * 0.8)))
    local pts = {}
    for i = 0, segs do
      local t = i / segs
      if t > head + 0.0001 then break end
      local x, y = M.bez_point(s, t)
      local wob = math.sin(t*6.3 + s.seed)*2.4 + math.sin(t*15.1 + s.seed*1.7)*1.1
      x, y = x + px*wob, y + py*wob
      local w = math.max(GRID, (s.thick_cur or s.thick) * (0.55 + 0.45*(1-t)))
      table.insert(pts, {x=x, y=y, w=w, t=t})
    end
    for _, p in ipairs(pts) do emit(p.x, p.y, p.w + GRID*1.4, pal.edge, 1) end
    for _, p in ipairs(pts) do
      emit(p.x, p.y, p.w, p.t < 0.55 and pal.body or pal.deep2, 1)
    end
    for _, p in ipairs(pts) do
      emit(p.x - px*p.w*0.22, p.y - py*p.w*0.22, math.max(GRID, p.w - GRID*2), pal.wet, 0.85)
    end
    local hp = pts[#pts]
    if hp then
      local hth = s.thick_cur or s.thick
      emit(hp.x, hp.y, hth*0.7 + GRID, pal.edge, 1)
      emit(hp.x, hp.y, hth*0.6, pal.node, 1)
      emit(hp.x, hp.y, GRID, pal.flash, 0.9)
    end
  end
  -- dryp (tegnes altid i lit-palet)
  local dp = M.palette(lit_col)
  for _, d in ipairs(M.drips) do
    local hang = math.max(GRID, d.hang)
    emit(d.x, d.y, GRID, dp.edge, 0.85)
    emit(d.x, d.y + GRID, GRID, dp.body, 1)
    emit(d.x, d.y + hang, GRID + (d.age > 0.75 and GRID or 0), dp.wet, 0.95)
    emit(d.x, d.y + hang + GRID, GRID, dp.deep2, 0.8)
  end
end

return M
