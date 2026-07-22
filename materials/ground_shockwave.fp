// The cone ability's ground shockwave, from the design handoff
// (Raw_Assets/Grafik/Animation Effekter/Shockwave landskabseffekt): a
// pressure wave displaces the UVs the ground is sampled with, so the
// landscape's own drawing is pushed outward as the front passes, with a
// brightness kiss on the crest. The math is the handoff's GLSL verbatim;
// only the spaces differ -- we work in world pixels (the handoff's demo
// worked in screen-height units), and uv_k converts the accumulated
// world-pixel offset into this sprite's texture UVs at the end.
//
// Eight wave slots, the handoff's contract. A slot is dead while its
// a.w flag is zero; dead slots cost one uniform branch and nothing else.
varying mediump vec2 var_texcoord0;
varying highp vec2 var_world_pos;

uniform lowp sampler2D texture_sampler;
uniform lowp vec4 tint;

// Per wave: a = (origin.x, origin.y, start_time, active), b = (aim.x, aim.y, cos_half, 0)
uniform highp vec4 wave0_a; uniform highp vec4 wave0_b;
uniform highp vec4 wave1_a; uniform highp vec4 wave1_b;
uniform highp vec4 wave2_a; uniform highp vec4 wave2_b;
uniform highp vec4 wave3_a; uniform highp vec4 wave3_b;
uniform highp vec4 wave4_a; uniform highp vec4 wave4_b;
uniform highp vec4 wave5_a; uniform highp vec4 wave5_b;
uniform highp vec4 wave6_a; uniform highp vec4 wave6_b;
uniform highp vec4 wave7_a; uniform highp vec4 wave7_b;

// wparams_a = (amplitude px, speed px/s, width px, ripples)
// wparams_b = (decay /s, shading, range px, now s)
uniform highp vec4 wparams_a;
uniform highp vec4 wparams_b;
// uv_k.xy: world px -> this texture's uv (y negated: world up is v down)
uniform highp vec4 uv_k;

void wave(highp vec4 a, highp vec4 b, highp vec2 p, inout highp vec2 off, inout highp float shade)
{
    if (a.w < 0.5) return;
    highp float t = wparams_b.w - a.z;
    if (t < 0.0) return;

    highp vec2 rel = p - a.xy;
    highp float d = length(rel);
    highp vec2 dir = d > 1e-3 ? rel / d : vec2(0.0);

    // cone mask, soft +-0.10 edge on the cosine (handoff verbatim)
    highp float mask = smoothstep(b.z - 0.10, b.z + 0.10, dot(dir, b.xy));

    highp float R = wparams_a.y * t;
    highp float x = (d - R) / wparams_a.z;

    highp float env = exp(-wparams_b.x * t)
        * exp(-x * x * 0.6)
        * mask;
    env *= 1.0 - smoothstep(wparams_b.z * 0.75, wparams_b.z, d);

    highp float shape = sin(-x * wparams_a.w) * env;

    off += dir * shape * wparams_a.x;
    shade += shape;
}

void main()
{
    highp vec2 p = var_world_pos;
    highp vec2 off = vec2(0.0);
    highp float shade = 0.0;

    wave(wave0_a, wave0_b, p, off, shade);
    wave(wave1_a, wave1_b, p, off, shade);
    wave(wave2_a, wave2_b, p, off, shade);
    wave(wave3_a, wave3_b, p, off, shade);
    wave(wave4_a, wave4_b, p, off, shade);
    wave(wave5_a, wave5_b, p, off, shade);
    wave(wave6_a, wave6_b, p, off, shade);
    wave(wave7_a, wave7_b, p, off, shade);

    mediump vec2 suv = var_texcoord0 - off * uv_k.xy;
    lowp vec4 col = texture2D(texture_sampler, suv);
    col.rgb *= 1.0 + clamp(shade, -1.0, 1.0) * wparams_b.y * 2.0;

    // The builtin sprite tint, premultiplied the same way.
    lowp vec4 tint_pm = vec4(tint.xyz * tint.w, tint.w);
    gl_FragColor = col * tint_pm;
}
