// The designer's tuning (#120): the wheel's steps and the ranges of a corner's radius and a lane's width, shared by
// the designer (the wheel over a point) and its panels (the number fields).
/** wheel delta (pixels) per step = one mouse-wheel notch; trackpads add up their small deltas */
export const WHEEL_PX_PER_STEP = 100;
export const WHEEL_STEP = 0.05; // m: radius / width resolution; a radius step is ~10% (at least this)
export const WHEEL_WIDTH_STEP = 0.1; // m of lane width per notch
export const RADIUS_RANGE: [number, number] = [0, 15];
export const WIDTH_RANGE: [number, number] = [0.8, 5];
