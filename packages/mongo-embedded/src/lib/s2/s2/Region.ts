// Changed from s2js 1.44.0 (Apache-2.0): the changes are listed in vendor/PATCHES.md
import { Cap } from './Cap.js'
import { Rect } from './Rect.js'
import { Cell } from './Cell.js'
import { Point } from './Point.js'
import type { CellID } from './cellid.js'

export interface Region {
  // // Returns a bounding spherical cap. This is not guaranteed to be exact.
  // capBound(): Cap

  // // Returns a bounding latitude-longitude rectangle that contains
  // // the region. The bounds are not guaranteed to be tight.
  // rectBound(): Rect

  // Reports whether the region completely contains the given region.
  // It returns false if containment could not be determined.
  containsCell(c: Cell): boolean

  // Reports whether the region intersects the given cell or
  // if intersection could not be determined. It returns false if the region
  // does not intersect.
  intersectsCell(c: Cell): boolean

  // Reports whether the region contains the given point or not.
  // The point should be unit length, although some implementations may relax
  // this restriction.
  containsPoint(p: Point): boolean

  // Returns a small collection of CellIDs whose union covers
  // the region. The cells are not sorted, may have redundancies (such as cells
  // that contain other cells), and may cover much more area than necessary.
  //
  // This method is not intended for direct use by client code. Clients
  // should typically use Covering, which has options to control the size and
  // accuracy of the covering. Alternatively, if you want a fast covering and
  // don't care about accuracy, consider calling FastCovering (which returns a
  // cleaned-up version of the covering computed by this method).
  //
  // CellUnionBound implementations should attempt to return a small
  // covering (ideally 4 cells or fewer) that covers the region and can be
  // computed quickly. The result is used by RegionCoverer as a starting
  // point for further refinement.
  cellUnionBound(): CellID[]
}

// NilRegion represents a Nil value
export class NilRegion implements Region {
  capBound(): Cap {
    return Cap.emptyCap()
  }
  rectBound(): Rect {
    return Rect.emptyRect()
  }
  containsCell(_c: Cell): boolean {
    return false
  }
  intersectsCell(_c: Cell): boolean {
    return false
  }
  containsPoint(_p: Point): boolean {
    return false
  }
  cellUnionBound(): CellID[] {
    return []
  }
}
