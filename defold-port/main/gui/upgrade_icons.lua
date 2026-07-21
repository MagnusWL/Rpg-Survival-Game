-- One shared map from upgrade kind to its icon in the skilltree atlas, so
-- every upgrade reads as a face like a skill does rather than a bare colour
-- swatch. Reuses icons the active skill tree doesn't (pierce's old "impale"
-- icon fits its upgrade namesake exactly).
return {
	dmg = "cleave",
	atkspd = "ricochet",
	health = "bonewall",
	healthregen = "bloodpact",
	haste = "whirlwind",
	summonregen = "raisedead",
	pierce = "impale",
}
