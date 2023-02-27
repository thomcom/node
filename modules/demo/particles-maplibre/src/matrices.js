/**
 * Copyright (c) 2022 NVIDIA Corporation
 */

const mat4     = require('gl-mat4');
const glmatrix = require('gl-matrix');

/*
 A utility function that computes A for Ax = b where
 x and b are known.
 */
export const getProjection = (space1, space2) => {
  const w        = space1;
  const s        = space2;
  const wst      = mat4.multiply([], w, mat4.transpose([], s));
  const sst      = mat4.multiply([], s, mat4.transpose([], s));
  const identity = glmatrix.mat4.multiplyScalar([], mat4.identity([]), 0.00001);
  const sstInv   = mat4.invert([], glmatrix.mat4.add([], sst, identity));
  const A        = mat4.multiply([], wst, sstInv);
  return A;
};

/*
 A function that computes a zoom level based on a zoomLevel that ranges from 0 to n.
 TODO: Currently the range of the zoomLevel can be negative. This should be corrected.
 */
export const getCurrentOrthoScale =
  (props) => { return 1 / props.zoomLevel};  // Math.pow(1.4, props.zoomLevel);};

/*
 The orthographic projection matrix for points. Various from the background only
 in axis direction. By inverting the y axis it flips the points to respect the negative
 orientation of Latitude in the northern hemisphere.
 */
export const getPointsProjectionMatrix = (props) => {
  const orthoScale = getCurrentOrthoScale(props);
  return mat4.ortho(
    [], orthoScale * 20.0, -orthoScale * 20.0, orthoScale * 10, -orthoScale * 10, 1, 1000);
};

/*
 The background projection matrix flips the x axis.
 */
export const getBackgroundProjectionMatrix = (props) => {
  const orthoScale = getCurrentOrthoScale(props);
  return mat4.ortho(
    [], -orthoScale * 20.0, orthoScale * 20.0, orthoScale * 10, -orthoScale * 10, 1, 1000);
};
