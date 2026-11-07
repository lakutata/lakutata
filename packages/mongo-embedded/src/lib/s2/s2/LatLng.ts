// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import type { Angle } from '../s1/angle.js'
import { DEGREE } from '../s1/angle_constants.js'
import * as angle from '../s1/angle.js'
import { remainder } from '../r1/math.js'
import { Point } from './Point.js'

const NORTH_POLE_LAT: Angle = Math.PI / 2
const SOUTH_POLE_LAT: Angle = -NORTH_POLE_LAT

/**
 * Represents a point on the unit sphere as a pair of angles.
 */
export class LatLng {
  lat: Angle
  lng: Angle

  /**
   * Returns a new LatLng.
   * @category Constructors
   */
  constructor(lat: Angle, lng: Angle) {
    this.lat = lat
    this.lng = lng
  }

  /**
   * Returns a LatLng for the coordinates given in degrees.
   * @category Constructors
   */
  static fromDegrees(lat: number, lng: number): LatLng {
    return new LatLng(lat * DEGREE, lng * DEGREE)
  }

  /**
   * Returns the latitude of the given point.
   */
  static latitude(p: Point): number {
    const v = p.vector
    return Math.atan2(v.z, Math.sqrt(v.x * v.x + v.y * v.y))
  }

  /**
   * Returns the longitude of the given point.
   */
  static longitude(p: Point): number {
    return Math.atan2(p.vector.y, p.vector.x)
  }

  /**
   * Returns a LatLng for a given Point.
   * @category Constructors
   */
  static fromPoint(p: Point): LatLng {
    return new LatLng(this.latitude(p), this.longitude(p))
  }

  /**
   * Returns true if and only if the LatLng is normalized,
   * with lat ∈ [-π/2,π/2] and lng ∈ [-π,π].
   */
  isValid(): boolean {
    return Math.abs(this.lat) <= Math.PI / 2 && Math.abs(this.lng) <= Math.PI
  }

  /**
   * Returns the normalized version of the LatLng,
   * with lat clamped to [-π/2,π/2] and lng wrapped in [-π,π].
   */
  normalized(): LatLng {
    let lat = this.lat
    if (lat > NORTH_POLE_LAT) lat = NORTH_POLE_LAT
    else if (lat < SOUTH_POLE_LAT) lat = SOUTH_POLE_LAT
    const lng = remainder(this.lng, 2 * Math.PI)
    return new LatLng(lat, lng)
  }

  /**
   * Returns the string representation of the LatLng.
   */
  toString(): string {
    return `[${angle.toString(this.lat)}, ${angle.toString(this.lng)}]`
  }

  /**
   * Returns the angle between two LatLngs.
   */
  distance(oll: LatLng): number {
    const dlat = Math.sin(0.5 * (oll.lat - this.lat))
    const dlng = Math.sin(0.5 * (oll.lng - this.lng))
    const x = dlat * dlat + dlng * dlng * Math.cos(this.lat) * Math.cos(oll.lat)
    return 2 * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)))
  }

  /**
   * Reports whether the latitude and longitude of the two LatLngs
   * are the same up to a small tolerance.
   */
  approxEqual(oll: LatLng): boolean {
    return angle.approxEqual(this.lat, oll.lat) && angle.approxEqual(this.lng, oll.lng)
  }
}
