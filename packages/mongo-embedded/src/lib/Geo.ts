import { EmbeddedOperationError } from './Errors.js'
import { GEO_DISTANCE, GEO_POINT, setGeoNear } from './mingo/util/_meta.js'
import { type EmbeddedIndex } from './Planner.js'
import { Interval as R1Interval } from './s2/r1/Interval.js'
import { type Vector } from './s2/r3/Vector.js'
import { Interval as S1Interval } from './s2/s1/Interval.js'
import { Cap } from './s2/s2/Cap.js'
import { Cell } from './s2/s2/Cell.js'
import * as cellid from './s2/s2/cellid.js'
import { CellUnion } from './s2/s2/CellUnion.js'
import { CROSS, crossingSign, DO_NOT_CROSS } from './s2/s2/edge_crossings.js'
import { LatLng } from './s2/s2/LatLng.js'
import { Loop } from './s2/s2/Loop.js'
import { Point } from './s2/s2/Point.js'
import { Polygon } from './s2/s2/Polygon.js'
import { Polyline } from './s2/s2/Polyline.js'
import { Rect } from './s2/s2/Rect.js'
import { type Region } from './s2/s2/Region.js'
import { RectBounder } from './s2/s2/RectBounder.js'
import { RegionCoverer } from './s2/s2/RegionCoverer.js'
import { type EmbeddedDocument } from './Values.js'

export { GEO_DISTANCE, GEO_POINT }

/**
 * The radius of the earth MongoDB 8.0 measures the distances of the spheres by, in meters
 */
export const EARTH_RADIUS = 6378100

/**
 * The names of the coordinate reference systems of GeoJSON: WGS 84 (the default), and MongoDB's own one of the big
 * polygons, their interior on the left of their ring (a polygon larger than a hemisphere)
 */
const SPHERE_CRS = ['EPSG:4326', 'urn:ogc:def:crs:OGC:1.3:CRS84']
const STRICT_CRS = 'urn:x-mongodb:crs:strictwinding:EPSG:4326'

/**
 * The cells of the geometries of a 2dsphere index other than points (a point: its leaf cell, as MongoDB 8.0 indexes
 * it): 20 at most, of levels 23 (about a meter) at most
 */
const DOCUMENT_LEVEL = 23
const DOCUMENT_COVERER = new RegionCoverer({ maxLevel: DOCUMENT_LEVEL, maxCells: 20 })

/**
 * The cells of the region of a query, read in a 2dsphere index
 */
const QUERY_COVERER = new RegionCoverer({ maxLevel: 30, maxCells: 20 })

/**
 * The cells of a 2d index a query reads at most (each a range of its keys)
 */
const HASH_CELLS = 64

/**
 * The radius of the first ring of a $near read in a 2dsphere index (radians: about 640 m), and how much each next
 * ring grows
 */
const FIRST_RING = 1e-4
const RING_GROWTH = 4

/**
 * The failure of a geometry: its message, and the code MongoDB 8.0 fails a write with (16755, Can't extract geo keys,
 * by default)
 */
class GeoError extends Error {
    constructor(message: string, readonly code = 16755) {
        super(message)
    }
}

/**
 * A point of a geometry: its coordinates as given (longitude and latitude, or the x and the y of a plane), its point on
 * the sphere (none for coordinates out of its bounds, matched on a plane only)
 */
export interface GeoPoint {
    kind: 'point'
    x: number
    y: number
    point?: Point
}

/**
 * A geometry on the sphere: a point, a line (LineString), a polygon, or the parts of a MultiPoint, a MultiLineString, a
 * MultiPolygon or a GeometryCollection
 */
export type GeoShape =
    | GeoPoint
    | { kind: 'line', line: Polyline }
    | { kind: 'polygon', polygon: Polygon }
    | { kind: 'multi', parts: GeoShape[] }

/**
 * The region of a $geoWithin: polygons (a Polygon or a MultiPolygon, a big polygon too), a cap ($centerSphere), or a
 * shape of a plane ($box, $polygon, $center), which matches points only
 */
type GeoRegion =
    | { kind: 'polygons', polygons: Polygon[] }
    | { kind: 'cap', cap: Cap }
    | { kind: 'box', minX: number, minY: number, maxX: number, maxY: number }
    | { kind: 'flatPolygon', points: [number, number][] }
    | { kind: 'circle', x: number, y: number, radius: number }

/**
 * Whether a value is a document (not an array, nor a value of BSON)
 *
 * @param value
 */
function isDocument(value: unknown): value is EmbeddedDocument {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
}

/**
 * The number of a value of a numeric type (a number, Int32, Double, Long, Decimal128), else undefined
 *
 * @param value
 */
function numberOf(value: unknown): number | undefined {
    if (typeof value === 'number') return value
    if (typeof value === 'bigint') return Number(value)
    const type = (value as { _bsontype?: string } | null | undefined)?._bsontype
    if (type === 'Int32' || type === 'Double') return Number((value as { valueOf(): number }).valueOf())
    if (type === 'Long') return (value as { toNumber(): number }).toNumber()
    if (type === 'Decimal128') return Number(String(value))
    return undefined
}

/**
 * The name of the type of a value, as MongoDB names it in its messages
 *
 * @param value
 */
function typeNameOf(value: unknown): string {
    if (value === undefined) return 'missing'
    if (value === null) return 'null'
    if (Array.isArray(value)) return 'array'
    if (typeof value === 'boolean') return 'bool'
    if (typeof value === 'string') return 'string'
    if (numberOf(value) !== undefined) return 'double'
    return 'object'
}

/**
 * A value shown in a message
 *
 * @param value
 */
function shown(value: unknown): string {
    try {
        return JSON.stringify(value, (_, item) => (typeof item === 'bigint' ? Number(item) : item)) ?? String(value)
    } catch {
        return String(value)
    }
}

/**
 * The coordinates of a point given as an array or a document (its first two values), numbers
 *
 * @param value
 */
function pairOf(value: unknown): [number, number] {
    const items = Array.isArray(value) ? value : isDocument(value) ? Object.values(value) : undefined
    if (!items) throw new GeoError(`Point must be an array or object, instead got type ${typeNameOf(value)}`)
    const x = numberOf(items[0])
    if (x === undefined) throw new GeoError(`Point must only contain numeric elements, instead got type ${typeNameOf(items[0])}`)
    const y = numberOf(items[1])
    if (y === undefined) throw new GeoError(`Point must only contain numeric elements, instead got type ${typeNameOf(items[1])}`)
    return [x, y]
}

/**
 * The point on the sphere of a longitude and a latitude, in degrees
 *
 * @param x
 * @param y
 */
function spherePoint(x: number, y: number): Point {
    return Point.fromLatLng(LatLng.fromDegrees(y, x))
}

/**
 * Whether a longitude and a latitude are within their bounds
 *
 * @param x
 * @param y
 */
function onSphere(x: number, y: number): boolean {
    return x >= -180 && x <= 180 && y >= -90 && y <= 90
}

/**
 * A point of legacy coordinates (an array or a document of two numbers) on the sphere
 *
 * @param value
 */
function legacyPointOf(value: unknown): GeoPoint {
    const [x, y] = pairOf(value)
    if (!onSphere(x, y)) throw new GeoError(`can't project geometry into spherical CRS: [ ${x}, ${y} ]`)
    return { kind: 'point', x: x, y: y, point: spherePoint(x, y) }
}

/**
 * A point of GeoJSON coordinates: finite numbers, within the bounds of the sphere
 *
 * @param coordinates
 */
function geoJSONPointOf(coordinates: unknown): GeoPoint {
    const [x, y] = pairOf(coordinates)
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new GeoError('Point coordinates must be finite numbers')
    if (!onSphere(x, y)) throw new GeoError(`Longitude/latitude is out of bounds, lng: ${x} lat: ${y}`)
    return { kind: 'point', x: x, y: y, point: spherePoint(x, y) }
}

/**
 * The coordinate reference system of a GeoJSON geometry: the sphere, or the strict winding of MongoDB (big polygons)
 *
 * @param geometry
 */
function strictOf(geometry: EmbeddedDocument): boolean {
    if (geometry.crs === undefined) return false
    const crs = geometry.crs
    if (!isDocument(crs)) throw new GeoError('GeoJSON coordinate reference system must be an object')
    if (crs.type !== 'name') throw new GeoError('GeoJSON CRS must have field "type": "name"')
    if (!isDocument(crs.properties)) throw new GeoError('CRS must have field "properties" which is an object')
    const name = crs.properties.name
    if (typeof name !== 'string') throw new GeoError('In CRS, "properties.name" must be a string')
    if (SPHERE_CRS.includes(name)) return false
    if (name === STRICT_CRS) return true
    throw new GeoError(`Unknown CRS name: ${name}`)
}

/**
 * The points of the coordinates of a LineString, the ones repeated after themselves once (2 at least)
 *
 * @param coordinates
 */
function lineOf(coordinates: unknown): Polyline {
    if (!Array.isArray(coordinates)) throw new GeoError(`GeoJSON coordinates must be an array: ${shown(coordinates)}`)
    const points: Point[] = []
    for (const item of coordinates) {
        const point = geoJSONPointOf(item).point!
        if (!points.length || !points[points.length - 1].equals(point)) points.push(point)
    }
    if (points.length < 2)
        throw new GeoError(`GeoJSON LineString must have at least 2 vertices, instead got ${points.length} vertices: ${shown(coordinates)}`)
    return new Polyline(points)
}

/**
 * The polygon of the coordinates of a Polygon, as MongoDB 8.0 makes it: each ring closed (4 points at least, its last
 * the first), its points repeated after themselves once, 3 different points at least, a valid loop (not crossing
 * itself); each loop the smaller of the two regions it bounds (unless strict: its interior on the left), the loops
 * after the first inside it (holes); a valid polygon
 *
 * @param coordinates
 * @param strict whether its rings keep their winding (a big polygon: one ring)
 */
function polygonOf(coordinates: unknown, strict = false): Polygon {
    if (!Array.isArray(coordinates)) throw new GeoError(`Polygon coordinates must be an array: ${shown(coordinates)}`)
    if (!coordinates.length) throw new GeoError('Polygon has no loops.')
    if (strict && coordinates.length > 1) throw new GeoError('Only one ring is supported in a big polygon')
    const loops: Loop[] = []
    for (const ring of coordinates) {
        if (!Array.isArray(ring)) throw new GeoError(`Polygon loop must be an array: ${shown(ring)}`)
        if (!ring.length) throw new GeoError(`Loop has no vertices: ${shown(ring)}`)
        const given = ring.map((item) => geoJSONPointOf(item))
        if (given.length < 4) throw new GeoError(`Loop must have at least 4 vertices: ${shown(ring)}`)
        const first = given[0]
        const last = given[given.length - 1]
        if (first.x !== last.x || first.y !== last.y)
            throw new GeoError(`Loop is not closed, first vertex does not equal last vertex: ${shown(ring)}`)
        const points: Point[] = []
        for (const item of given.slice(0, -1))
            if (!points.length || !points[points.length - 1].equals(item.point!)) points.push(item.point!)
        const unique = new Set(points.map(({ vector }) => `${vector.x},${vector.y},${vector.z}`)).size
        if (unique < 3)
            throw new GeoError(`Loop must have at least 3 different vertices, ${unique} unique vertices were provided: ${shown(ring)}`)
        const loop = new Loop(points)
        const invalid = loop.validate()?.message ?? loopCrossingOf(points)
        if (invalid) throw new GeoError(`Loop is not valid: ${shown(ring)} ${invalid}`)
        if (!strict) loop.normalize()
        if (loops.length && !loops[0].contains(loop))
            throw new GeoError(`Secondary loops not contained by first exterior loop - secondary loops must be holes: ${shown(ring)}`)
        loops.push(loop)
    }
    const polygon = new Polygon(loops)
    if (loops.length > 1) {
        const invalid = polygon.validate()
        if (invalid) throw new GeoError(`Polygon isn't valid: ${invalid.message} ${shown(coordinates)}`)
    }
    return polygon
}

/**
 * The failure of the vertices of a loop as the S2 of MongoDB 8.0 finds it: a vertex repeated, or two edges crossing
 * (the edges whose bounds meet compared, swept by their latitudes); undefined when there is none
 *
 * @param points
 */
function loopCrossingOf(points: Point[]): string | undefined {
    const seen = new Map<string, number>()
    for (const [position, { vector }] of points.entries()) {
        const key = `${vector.x},${vector.y},${vector.z}`
        if (seen.has(key)) return `Duplicate vertices: ${seen.get(key)} and ${position}`
        seen.set(key, position)
    }
    const count = points.length
    const edges = points.map((point, position) => {
        const bounder = new RectBounder()
        bounder.addPoint(point)
        bounder.addPoint(points[(position + 1) % count])
        return { position: position, rect: bounder.rectBound() }
    })
    edges.sort((a, b) => a.rect.lat.lo - b.rect.lat.lo)
    let active: typeof edges = []
    for (const edge of edges) {
        active = active.filter((other) => other.rect.lat.hi >= edge.rect.lat.lo)
        for (const other of active) {
            const i = Math.min(edge.position, other.position)
            const j = Math.max(edge.position, other.position)
            if (j === i + 1 || (i === 0 && j === count - 1) || !edge.rect.intersects(other.rect)) continue
            if (crossingSign(points[i], points[(i + 1) % count], points[j], points[(j + 1) % count]) === CROSS)
                return `Edges ${i} and ${j} cross.`
        }
        active.push(edge)
    }
    return undefined
}

/**
 * The parts of the coordinates of a Multi* geometry (one at least)
 *
 * @param coordinates
 * @param type its type
 * @param part the shape of a part
 */
function partsOf(coordinates: unknown, type: string, part: (value: unknown) => GeoShape): GeoShape {
    if (!Array.isArray(coordinates)) throw new GeoError(`GeoJSON coordinates must be an array: ${shown(coordinates)}`)
    if (!coordinates.length) throw new GeoError(`${type} coordinates must have at least 1 element`)
    return { kind: 'multi', parts: coordinates.map(part) }
}

/**
 * The shape of a GeoJSON geometry (its CRS the sphere: a strict winding fails as MongoDB fails it in an index)
 *
 * @param geometry
 * @param nested whether it is a geometry of a GeometryCollection
 */
function geoJSONShapeOf(geometry: EmbeddedDocument, nested = false): GeoShape {
    if (strictOf(geometry)) throw new GeoError("can't index geometry with strict winding order")
    switch (geometry.type) {
        case 'Point':
            return geoJSONPointOf(geometry.coordinates)
        case 'LineString':
            return { kind: 'line', line: lineOf(geometry.coordinates) }
        case 'Polygon':
            return { kind: 'polygon', polygon: polygonOf(geometry.coordinates) }
        case 'MultiPoint':
            return partsOf(geometry.coordinates, 'MultiPoint', geoJSONPointOf)
        case 'MultiLineString':
            return partsOf(geometry.coordinates, 'MultiLineString', (item) => ({ kind: 'line', line: lineOf(item) }))
        case 'MultiPolygon':
            return partsOf(geometry.coordinates, 'MultiPolygon', (item) => ({ kind: 'polygon', polygon: polygonOf(item) }))
        case 'GeometryCollection': {
            if (nested) throw new GeoError('GeometryCollections cannot be nested')
            const geometries = geometry.geometries
            if (!Array.isArray(geometries)) throw new GeoError('GeometryCollection geometries must be an array')
            if (!geometries.length) throw new GeoError('GeometryCollection geometries must have at least 1 element')
            return {
                kind: 'multi',
                parts: geometries.map((item, position) => {
                    if (!isDocument(item)) throw new GeoError(`Element ${position} of "geometries" is not an object`)
                    return geoJSONShapeOf(item, true)
                })
            }
        }
        default:
            throw new GeoError(`unknown GeoJSON type: ${shown(geometry)}`)
    }
}

/**
 * The geometry of a value in a 2dsphere index: a GeoJSON geometry (a document with a type), or legacy coordinates (an
 * array or a document of two numbers); none for null, an empty array and an empty document. It fails as MongoDB 8.0
 * fails a document it cannot index
 *
 * @param value
 * @param field the path of the value, for the messages
 */
function sphereShapeOf(value: unknown, field: string): GeoShape | undefined {
    if (value === undefined || value === null) return undefined
    if (Array.isArray(value)) return value.length ? legacyPointOf(value) : undefined
    if (isDocument(value)) {
        // Legacy coordinates when its first value is a number, else GeoJSON
        const values = Object.values(value)
        if (!values.length) return undefined
        return 'type' in value || numberOf(values[0]) === undefined ? geoJSONShapeOf(value) : legacyPointOf(value)
    }
    throw new GeoError(`geo element must be an array or object: ${field}: ${shown(value)}`)
}

/**
 * The geometry of a value a query tests (no error: none when it is not one), on the sphere, or on a plane (the points
 * only: legacy coordinates out of the bounds of the sphere too)
 *
 * @param value
 * @param flat
 */
function matchedShapeOf(value: unknown, flat: boolean): GeoShape | undefined {
    try {
        if (flat && (Array.isArray(value) || (isDocument(value) && !('type' in value) && numberOf(Object.values(value)[0]) !== undefined))) {
            const [x, y] = pairOf(value)
            return { kind: 'point', x: x, y: y, point: onSphere(x, y) ? spherePoint(x, y) : undefined }
        }
        return sphereShapeOf(value, '')
    } catch {
        return undefined
    }
}

/**
 * Whether a value holds a geometry passing a test: the value itself, else one of its items (an array of geometries, or
 * the values of a path through arrays)
 *
 * @param value
 * @param flat whether the test is on a plane
 * @param test
 */
function holds(value: unknown, flat: boolean, test: (shape: GeoShape) => boolean): boolean {
    const shape = matchedShapeOf(value, flat)
    if (shape) return test(shape)
    if (!Array.isArray(value)) return false
    return value.some((item) => {
        const part = Array.isArray(item) || isDocument(item) ? matchedShapeOf(item, flat) : undefined
        return !!part && test(part)
    })
}

/**
 * The parts of a shape (the shape itself when it has none)
 *
 * @param shape
 */
function partsOfShape(shape: GeoShape): GeoShape[] {
    return shape.kind === 'multi' ? shape.parts.flatMap(partsOfShape) : [shape]
}

/**
 * The leaf cell of a point (about a centimeter)
 *
 * @param point
 */
function leafOf(point: Point): Cell {
    return Cell.fromPoint(point)
}

/**
 * Whether a polygon holds a point, as MongoDB 8.0 tells it: inside it, or its leaf cell meeting it (a point on its
 * boundary)
 *
 * @param polygon
 * @param point
 */
function polygonHasPoint(polygon: Polygon, point: Point): boolean {
    return polygon.containsPoint(point) || polygon.intersectsCell(leafOf(point))
}

/**
 * The edges of the loops of a polygon
 *
 * @param polygon
 */
function edgesOf(polygon: Polygon): [Point, Point][] {
    const edges: [Point, Point][] = []
    for (let loop = 0; loop < polygon.numLoops(); loop++) {
        const vertices = polygon.loop(loop).vertices
        for (let i = 0; i < vertices.length; i++) edges.push([vertices[i], vertices[(i + 1) % vertices.length]])
    }
    return edges
}

/**
 * Whether a polygon holds a line: each of its vertices, and none of its edges crossing the boundary
 *
 * @param polygon
 * @param line
 */
function polygonHasLine(polygon: Polygon, line: Polyline): boolean {
    if (!line.points.every((point) => polygonHasPoint(polygon, point))) return false
    const edges = edgesOf(polygon)
    for (let i = 1; i < line.points.length; i++)
        for (const [c, d] of edges)
            if (crossingSign(line.points[i - 1], line.points[i], c, d) === CROSS) return false
    return true
}

/**
 * Whether a polygon meets a line: one of its vertices inside it, or one of its edges meeting the boundary
 *
 * @param polygon
 * @param line
 */
function polygonMeetsLine(polygon: Polygon, line: Polyline): boolean {
    if (line.points.some((point) => polygon.containsPoint(point))) return true
    const edges = edgesOf(polygon)
    for (let i = 1; i < line.points.length; i++)
        for (const [c, d] of edges)
            if (crossingSign(line.points[i - 1], line.points[i], c, d) !== DO_NOT_CROSS) return true
    return false
}

/**
 * The vertices of a shape
 *
 * @param shape
 */
function verticesOf(shape: GeoShape): Point[] {
    switch (shape.kind) {
        case 'point':
            return shape.point ? [shape.point] : []
        case 'line':
            return shape.line.points
        case 'polygon':
            return edgesOf(shape.polygon).map(([point]) => point)
        default:
            return shape.parts.flatMap(verticesOf)
    }
}

/**
 * Whether a point of a plane is in a polygon of a plane ($polygon), as MongoDB 8.0 tells it: one of its vertices, on
 * one of its horizontal or vertical edges, or inside it by the crossings of a ray to its right (a point on another edge
 * counted as a crossing)
 *
 * @param points
 * @param x
 * @param y
 */
function flatPolygonHas(points: [number, number][], x: number, y: number): boolean {
    let crossings = 0
    let [ax, ay] = points[0]
    for (let i = 1; i <= points.length; i++) {
        const [bx, by] = points[i % points.length]
        if ((x === ax && y === ay) || (x === bx && y === by)) return true
        if (ay === by && y === ay && x >= Math.min(ax, bx) && x <= Math.max(ax, bx)) return true
        if (y > Math.min(ay, by) && y <= Math.max(ay, by) && x <= Math.max(ax, bx) && ay !== by) {
            const crossing = ((y - ay) * (bx - ax)) / (by - ay) + ax
            if (ax === bx && x === ax) return true
            if (ax === bx || x <= crossing) crossings++
        }
        ax = bx
        ay = by
    }
    return crossings % 2 === 1
}

/**
 * The distance of two points of a plane, as MongoDB 8.0 computes it
 *
 * @param ax
 * @param ay
 * @param bx
 * @param by
 */
function flatDistance(ax: number, ay: number, bx: number, by: number): number {
    const a = ax - bx
    const b = ay - by
    if (a === 0) return Math.abs(b)
    if (b === 0) return Math.abs(a)
    return Math.sqrt(a * a + b * b)
}

/**
 * Whether a shape is within a region ($geoWithin), as MongoDB 8.0 tells it: each of its parts in one of the polygons,
 * each of its vertices in the cap; a point only in the shapes of a plane
 *
 * @param region
 * @param shape
 */
function within(region: GeoRegion, shape: GeoShape): boolean {
    switch (region.kind) {
        case 'polygons':
            return partsOfShape(shape).every((part) => {
                if (part.kind === 'point') return !!part.point && region.polygons.some((polygon) => polygonHasPoint(polygon, part.point!))
                if (part.kind === 'line') return region.polygons.some((polygon) => polygonHasLine(polygon, part.line))
                return part.kind === 'polygon' && region.polygons.some((polygon) => polygon.contains(part.polygon))
            })
        case 'cap': {
            const vertices = verticesOf(shape)
            return vertices.length > 0 && partsOfShape(shape).every((part) => part.kind !== 'point' || !!part.point) && vertices.every((point) => region.cap.containsPoint(point))
        }
        case 'box':
            return shape.kind === 'point' && shape.x >= region.minX && shape.x <= region.maxX && shape.y >= region.minY && shape.y <= region.maxY
        case 'flatPolygon':
            return shape.kind === 'point' && flatPolygonHas(region.points, shape.x, shape.y)
        case 'circle':
            return shape.kind === 'point' && flatDistance(shape.x, shape.y, region.x, region.y) <= region.radius
    }
}

/**
 * Whether two shapes meet ($geoIntersects), as MongoDB 8.0 tells it: two of their parts meeting (two points in the
 * same leaf cell, a point in the leaf cell of which a line passes, a polygon holding a point, edges meeting, polygons
 * meeting)
 *
 * @param a
 * @param b
 */
function meets(a: GeoShape, b: GeoShape): boolean {
    const others = partsOfShape(b)
    return partsOfShape(a).some((part) => others.some((other) => partsMeet(part, other)))
}

/**
 * Whether two parts of shapes (not multi) meet
 *
 * @param a
 * @param b
 */
function partsMeet(a: GeoShape, b: GeoShape): boolean {
    if (b.kind === 'point' && a.kind !== 'point') return partsMeet(b, a)
    if (a.kind === 'point') {
        if (!a.point) return false
        if (b.kind === 'point') return !!b.point && cellid.fromPoint(a.point) === cellid.fromPoint(b.point)
        if (b.kind === 'line') return b.line.intersectsCell(leafOf(a.point))
        return b.kind === 'polygon' && polygonHasPoint(b.polygon, a.point)
    }
    if (a.kind === 'line') {
        if (b.kind === 'line') return a.line.intersects(b.line)
        return b.kind === 'polygon' && polygonMeetsLine(b.polygon, a.line)
    }
    if (a.kind === 'polygon') {
        if (b.kind === 'line') return polygonMeetsLine(a.polygon, b.line)
        return b.kind === 'polygon' && a.polygon.intersects(b.polygon)
    }
    return false
}

/**
 * A failure of a query: BadValue (2)
 *
 * @param message
 */
function badValue(message: string): EmbeddedOperationError {
    return new EmbeddedOperationError(2, 'BadValue', message)
}

/**
 * The value of a query's shape, its parse failing with BadValue
 *
 * @param parse
 */
function parsed<T>(parse: () => T): T {
    try {
        return parse()
    } catch (error) {
        if (error instanceof GeoError) throw badValue(error.message)
        throw error
    }
}

/**
 * The geometry of a query ($geometry): a GeoJSON geometry, a Polygon of the strict winding too (a big polygon)
 *
 * @param geometry
 */
function queryGeometryOf(geometry: unknown): GeoShape {
    if (!isDocument(geometry)) throw new GeoError(`$geometry must be an object: ${shown(geometry)}`)
    if (strictOf(geometry)) {
        if (geometry.type !== 'Polygon') throw new GeoError('Strict winding order is only supported by Polygon')
        return { kind: 'polygon', polygon: polygonOf(geometry.coordinates, true) }
    }
    return geoJSONShapeOf(geometry)
}

/**
 * The center and the radius of a $center or a $centerSphere: an array or a document of a point and a number not
 * negative
 *
 * @param value
 */
function circleOf(value: unknown): { center: [number, number], radius: number } {
    const items = Array.isArray(value) ? value : isDocument(value) ? Object.values(value) : []
    const center = pairOf(items[0])
    const radius = numberOf(items[1])
    if (radius === undefined || !(radius >= 0)) throw new GeoError(`Radius must be a non-negative number: ${items[1] === undefined ? 'EOO' : shown(items[1])}`)
    return { center: center, radius: radius }
}

/**
 * The shapes of a geo query, its operator in the messages: one of its keys ($geometry, $box, $polygon, $center,
 * $centerSphere)
 *
 * @param operator
 * @param value
 */
function shapeOf(operator: string, value: unknown): [string, unknown] {
    if (!isDocument(value)) throw badValue(`${operator} must be an object`)
    const shapes = Object.keys(value).filter((key) => ['$geometry', '$box', '$polygon', '$center', '$centerSphere'].includes(key))
    if (!shapes.length) throw badValue("geo query doesn't have any geometry")
    if (shapes.length > 1) throw badValue(`${operator} doesn't accept multiple shapes ${operator}: ${shown(value)}`)
    return [shapes[0], value[shapes[0]]]
}

/**
 * The region of a $geoWithin (or $within), checked as MongoDB 8.0 checks it (BadValue)
 *
 * @param value
 */
function regionOf(value: unknown): GeoRegion {
    const [shape, given] = shapeOf('$geoWithin', value)
    return parsed((): GeoRegion => {
        switch (shape) {
            case '$geometry': {
                const geometry = queryGeometryOf(given)
                if (geometry.kind === 'polygon') return { kind: 'polygons', polygons: [geometry.polygon] }
                if (geometry.kind === 'multi' && isDocument(given) && given.type === 'MultiPolygon')
                    return { kind: 'polygons', polygons: geometry.parts.map((part) => (part as { polygon: Polygon }).polygon) }
                throw new GeoError(`$within not supported with provided geometry: ${shown({ $geoWithin: value })}`)
            }
            case '$box': {
                const items = Array.isArray(given) ? given : isDocument(given) ? Object.values(given) : []
                const [ax, ay] = pairOf(items[0])
                const [bx, by] = pairOf(items[1])
                return { kind: 'box', minX: Math.min(ax, bx), minY: Math.min(ay, by), maxX: Math.max(ax, bx), maxY: Math.max(ay, by) }
            }
            case '$polygon': {
                const items = Array.isArray(given) ? given : isDocument(given) ? Object.values(given) : []
                const points = items.map((item) => pairOf(item))
                if (points.length < 3) throw new GeoError(`Polygon must have at least 3 points, instead got ${points.length} vertices`)
                return { kind: 'flatPolygon', points: points }
            }
            case '$center': {
                const { center, radius } = circleOf(given)
                return { kind: 'circle', x: center[0], y: center[1], radius: radius }
            }
            default: {
                const { center, radius } = circleOf(given)
                if (!onSphere(center[0], center[1])) throw new GeoError(`Longitude/latitude is out of bounds, lng: ${center[0]} lat: ${center[1]}`)
                return { kind: 'cap', cap: Cap.fromCenterAngle(spherePoint(center[0], center[1]), radius) }
            }
        }
    })
}

/**
 * The geometry of a $geoIntersects, checked as MongoDB 8.0 checks it (BadValue): a $geometry only
 *
 * @param value
 */
function intersectedOf(value: unknown): GeoShape {
    const [shape, given] = shapeOf('$geoIntersects', value)
    if (shape !== '$geometry') throw badValue(`$geoIntersect not supported with provided geometry: ${shown({ $geoIntersects: value })}`)
    return parsed(() => queryGeometryOf(given))
}

/**
 * The test of a $geoWithin (or $within) on the value of a field (mingo): its region parsed once (failing as MongoDB
 * fails it)
 *
 * @param value
 */
export function geoWithinTest(value: unknown): (field: unknown) => boolean {
    const region = regionOf(value)
    const flat = region.kind === 'box' || region.kind === 'flatPolygon' || region.kind === 'circle'
    return (field) => holds(field, flat, (shape) => within(region, shape))
}

/**
 * The test of a $geoIntersects on the value of a field (mingo): its geometry parsed once (failing as MongoDB fails it)
 *
 * @param value
 */
export function geoIntersectsTest(value: unknown): (field: unknown) => boolean {
    const geometry = intersectedOf(value)
    return (field) => holds(field, false, (shape) => meets(geometry, shape))
}

/**
 * The cross product of two points computed as the S2 of MongoDB 8.0 computes it ((b + a) x (b - a)), an orthogonal
 * vector for the same points
 *
 * @param a
 * @param b
 */
function robustCrossProduct(a: Vector, b: Vector): Vector {
    const x = b.add(a).cross(b.sub(a))
    if (x.x !== 0 || x.y !== 0 || x.z !== 0) return x
    return Point.ortho(Point.fromVector(a)).vector
}

/**
 * Whether three points are counterclockwise (by their triple product)
 *
 * @param a
 * @param b
 * @param c
 */
function simpleCCW(a: Vector, b: Vector, c: Vector): boolean {
    return c.cross(a).dot(b) > 0
}

/**
 * The angle of a point to an edge, as the S2 of MongoDB 8.0 computes it
 *
 * @param x
 * @param a
 * @param b
 */
function edgeDistance(x: Vector, a: Vector, b: Vector): number {
    const n = robustCrossProduct(a, b)
    if (simpleCCW(n, a, x) && simpleCCW(x, b, n)) return Math.asin(Math.min(1, Math.abs(x.dot(n)) / n.norm()))
    return 2 * Math.asin(Math.min(1, 0.5 * Math.sqrt(Math.min(x.sub(a).norm2(), x.sub(b).norm2()))))
}

/**
 * The point of an edge closest to a point, as the S2 of MongoDB 8.0 computes it
 *
 * @param x
 * @param a
 * @param b
 */
function closestPoint(x: Vector, a: Vector, b: Vector): Vector {
    const n = robustCrossProduct(a, b)
    const p = x.sub(n.mul(x.dot(n) / n.norm2()))
    if (simpleCCW(n, a, p) && simpleCCW(p, b, n)) return p.normalize()
    return x.sub(a).norm2() <= x.sub(b).norm2() ? a : b
}

/**
 * The angle between two points
 *
 * @param a
 * @param b
 */
function angleOf(a: Vector, b: Vector): number {
    return Math.atan2(a.cross(b).norm(), a.dot(b))
}

/**
 * The angle of a point to the closest of edges: to the point of the closest edge closest to it
 *
 * @param x
 * @param edges
 */
function edgesDistance(x: Vector, edges: [Vector, Vector][]): number {
    let minimum = 10
    let closest = 0
    edges.forEach(([a, b], position) => {
        const distance = edgeDistance(x, a, b)
        if (distance < minimum) {
            minimum = distance
            closest = position
        }
    })
    return angleOf(x, closestPoint(x, edges[closest][0], edges[closest][1]))
}

/**
 * The angle (radians) of a point to a shape, as MongoDB 8.0 measures it: to its closest part; 0 inside a polygon
 *
 * @param x
 * @param shape
 */
function sphereDistance(x: Point, shape: GeoShape): number {
    switch (shape.kind) {
        case 'point':
            return shape.point ? angleOf(x.vector, shape.point.vector) : Infinity
        case 'line': {
            const points = shape.line.points
            if (points.length === 1) return angleOf(x.vector, points[0].vector)
            return edgesDistance(x.vector, points.slice(1).map((point, position) => [points[position].vector, point.vector]))
        }
        case 'polygon':
            // 0 inside, else the distance to its closest edge (not through its closest point, as for a line)
            if (shape.polygon.containsPoint(x)) return 0
            return Math.min(...edgesOf(shape.polygon).map(([a, b]) => edgeDistance(x.vector, a.vector, b.vector)))
        default:
            return Math.min(...shape.parts.map((part) => sphereDistance(x, part)))
    }
}

/**
 * The kinds of the geo indexes
 */
export type GeoIndexKind = '2d' | '2dsphere'

/**
 * Whether an index is a geo index (a field of it 2d or 2dsphere)
 *
 * @param index
 */
export function isGeoIndex(index: EmbeddedIndex): boolean {
    return Object.values(index.key).some((direction) => direction === '2d' || direction === '2dsphere')
}

/**
 * The geo fields of an index and their kinds
 *
 * @param index
 */
export function geoFieldsOf(index: EmbeddedIndex): [string, GeoIndexKind][] {
    return Object.entries(index.key).filter(([, direction]) => direction === '2d' || direction === '2dsphere') as [string, GeoIndexKind][]
}

/**
 * The options of a geo index from the ones of createIndex, checked as MongoDB 8.0 checks them: a 2d index its first
 * field, the only geo field of its index, its bits (1 to 32, 26 by default), min and max (-180 and 180 by default,
 * listed when given); a 2dsphere index its version (1, 2 or 3, 3 by default, listed), its levels accepted and not kept.
 * Undefined for a key without a geo field
 *
 * @param key
 * @param options
 * @param failure the error of a specification that fails (CannotCreateIndex, 67)
 */
export function geoIndexOf(key: EmbeddedDocument, options: EmbeddedDocument, failure: (message: string) => Error): Partial<EmbeddedIndex> | undefined {
    const fields = Object.keys(key)
    const flat = fields.filter((field) => key[field] === '2d')
    const sphere = fields.filter((field) => key[field] === '2dsphere')
    if (!flat.length && !sphere.length) return undefined
    if (fields.some((field) => typeof key[field] === 'string' && key[field] !== '2d' && key[field] !== '2dsphere'))
        throw failure("Can't use more than one index plugin for a single index.")
    if (flat.length && sphere.length) throw failure("Can't use more than one index plugin for a single index.")
    if (flat.length) {
        if (flat.length > 1) throw new EmbeddedOperationError(16800, 'Location16800', "can't have 2 geo fields")
        if (fields[0] !== flat[0]) throw new EmbeddedOperationError(16801, 'Location16801', '2d has to be first in index')
        const listed: Partial<EmbeddedIndex> = {}
        const bits = options.bits === undefined ? 26 : numberOf(options.bits)
        if (bits === undefined || !Number.isInteger(bits) || bits < 1 || bits > 32)
            throw new EmbeddedOperationError(72, 'InvalidOptions', `bits for hash must be > 0 and <= 32, but ${shown(options.bits)} bits were specified`)
        const min = options.min === undefined ? -180 : numberOf(options.min)
        const max = options.max === undefined ? 180 : numberOf(options.max)
        if (min === undefined || max === undefined || !(min < max))
            throw new EmbeddedOperationError(72, 'InvalidOptions', `region for hash must be valid and have positive area, but [${shown(options.min ?? -180)}, ${shown(options.max ?? 180)}] was specified`)
        if (options.bits !== undefined) listed.bits = bits
        if (options.min !== undefined) listed.min = min
        if (options.max !== undefined) listed.max = max
        return listed
    }
    const version = options['2dsphereIndexVersion'] === undefined ? 3 : numberOf(options['2dsphereIndexVersion'])
    if (version !== 1 && version !== 2 && version !== 3)
        throw failure(`unsupported geo index version { 2dsphereIndexVersion : ${shown(options['2dsphereIndexVersion'])} }, only versions: [1,2,3] are supported`)
    return { '2dsphereIndexVersion': version }
}

/**
 * The values at a path of a document, through the arrays of its steps (not the one at its end: a geometry)
 *
 * @param value
 * @param path
 */
function geoValuesAt(value: unknown, path: string[]): unknown[] {
    if (!path.length) return value === undefined ? [] : [value]
    if (Array.isArray(value)) return value.flatMap((item) => (isDocument(item) ? geoValuesAt(item, path) : []))
    if (!isDocument(value)) return []
    return geoValuesAt(value[path[0]], path.slice(1))
}

/**
 * The locations of a value in a 2d index: a pair of numbers (an array whose first item is a number, or a document of
 * two values), or an array of them; none for another value. It fails as MongoDB 8.0 fails it
 *
 * @param value
 */
function flatLocationsOf(value: unknown): { value: unknown, x: number, y: number }[] {
    const pair = (item: unknown) => {
        const items = Array.isArray(item) ? item : Object.values(item as EmbeddedDocument)
        if (items.length < 2) throw new GeoError(`geo field only has ${items.length} element`, 13068)
        const x = numberOf(items[0])
        const y = numberOf(items[1])
        if (x === undefined || y === undefined) throw new GeoError('location object expected, location array not in correct format', 16804)
        return { value: item, x: x, y: y }
    }
    if (Array.isArray(value)) {
        if (!value.length) return []
        if (Array.isArray(value[0]) || isDocument(value[0])) return value.map(pair)
        return [pair(value)]
    }
    if (isDocument(value)) return Object.keys(value).length ? [pair(value)] : []
    return []
}

/**
 * The bits, the min and the max of a 2d index
 *
 * @param index
 */
function hashingOf(index: EmbeddedIndex): { bits: number, min: number, max: number } {
    return { bits: index.bits ?? 26, min: index.min ?? -180, max: index.max ?? 180 }
}

/**
 * A coordinate scaled to the 32 bits of a 2d hash
 *
 * @param value
 * @param min
 * @param max
 */
function hashScaled(value: number, min: number, max: number): number {
    return Math.min(Math.floor(((value - min) * 4294967296) / (max - min)), 0xffffffff)
}

/**
 * The 2d hash of a point, as MongoDB 8.0 makes it: the bits of its scaled coordinates interleaved (x first), the
 * 2 * bits first kept
 *
 * @param x
 * @param y
 * @param hashing
 */
function geoHashOf(x: number, y: number, hashing: { bits: number, min: number, max: number }): bigint {
    const hx = BigInt(hashScaled(x, hashing.min, hashing.max))
    const hy = BigInt(hashScaled(y, hashing.min, hashing.max))
    let hash = 0n
    for (let bit = 31n; bit >= 0n; bit--) hash = (hash << 2n) | (((hx >> bit) & 1n) << 1n) | ((hy >> bit) & 1n)
    const dropped = BigInt(64 - 2 * hashing.bits)
    return (hash >> dropped) << dropped
}

/**
 * The 8 bytes of a number of 64 bits, big-endian
 *
 * @param value
 */
function bytesOf(value: bigint): Buffer {
    const bytes = Buffer.allocUnsafe(8)
    bytes.writeBigUInt64BE(value)
    return bytes
}

/**
 * The cells of a shape in a 2dsphere index: the leaf cell of a point, a covering of a line or of a polygon
 *
 * @param shape
 */
function cellsOf(shape: GeoShape): bigint[] {
    switch (shape.kind) {
        case 'point':
            return [cellid.fromPoint(shape.point!)]
        case 'line':
            return [...DOCUMENT_COVERER.covering(shape.line)]
        case 'polygon':
            return [...DOCUMENT_COVERER.covering(shape.polygon)]
        default:
            return [...new Set(shape.parts.flatMap(cellsOf))]
    }
}

/**
 * The keys of a document in a geo index (KeyEncoding): the cells of the geometries of its 2dsphere fields, the 2d
 * hashes of the locations of its 2d field, the keys of its other fields (otherKeys); none for a document without
 * geometries (without locations: 2d), as MongoDB 8.0 leaves it out. A geometry it cannot index fails as MongoDB fails
 * it (16755; 13027, 13068, 16804 for 2d)
 *
 * @param index
 * @param document
 * @param otherKeys the keys of the values of another field (of the field '': the key of null)
 * @param binary the key of the bytes of a cell or of a hash
 */
export function geoKeysOf(index: EmbeddedIndex, document: EmbeddedDocument, otherKeys: (field: string) => Buffer[], binary: (bytes: Buffer) => Buffer): Buffer[] {
    const parts: Buffer[][] = []
    let geometries = false
    try {
        for (const [field, direction] of Object.entries(index.key)) {
            const values = geoValuesAt(document, field.split('.'))
            if (direction === '2dsphere') {
                const cells = new Set<bigint>()
                for (const value of values) {
                    const shape = sphereShapeOf(value, field)
                    if (shape) for (const cell of cellsOf(shape)) cells.add(cell)
                }
                if (cells.size) geometries = true
                // A field without a geometry: the key of null (the document indexed by its other geo fields)
                parts.push(cells.size ? [...cells].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((cell) => binary(bytesOf(cell))) : otherKeys(''))
            } else if (direction === '2d') {
                const hashing = hashingOf(index)
                const hashes = new Set<bigint>()
                for (const value of values)
                    for (const { x, y } of flatLocationsOf(value)) {
                        if (!(x >= hashing.min && x <= hashing.max && y >= hashing.min && y <= hashing.max))
                            throw new GeoError(`point not in interval of [ ${hashing.min}, ${hashing.max} ]`, 13027)
                        hashes.add(geoHashOf(x, y, hashing))
                    }
                if (!hashes.size) return []
                geometries = true
                parts.push([...hashes].map((hash) => binary(bytesOf(hash))))
            } else parts.push(otherKeys(field))
        }
    } catch (error) {
        if (!(error instanceof GeoError)) throw error
        throw new EmbeddedOperationError(error.code, `Location${error.code}`, error.code === 16755 ? `Can't extract geo keys: ${error.message}` : error.message)
    }
    if (!geometries) return []
    let keys: Buffer[] = [Buffer.alloc(0)]
    for (const part of parts) keys = keys.flatMap((key) => part.map((item) => Buffer.concat([key, item])))
    return keys
}

/**
 * A range of the keys of an index: from its lower key (in it) to its upper key (not in it; none: to the last key)
 */
export interface GeoRange {
    lower: Buffer
    upper: Buffer | undefined
}

/**
 * The ranges of the keys of a geo index holding the cells of a covering, after a prefix (the keys of the fields before
 * the geo field): the cells in each cell of the covering, and the cells holding it (their keys alone)
 *
 * @param covering
 * @param prefix
 * @param binary
 * @param after the first key after the keys starting with a key
 * @param looked the cells holding cells already read, not read again
 */
function cellRangesOf(covering: bigint[], prefix: Buffer, binary: (bytes: Buffer) => Buffer, after: (key: Buffer) => Buffer | undefined, looked = new Set<bigint>()): GeoRange[] {
    const ranges: GeoRange[] = []
    const key = (cell: bigint) => Buffer.concat([prefix, binary(bytesOf(cell))])
    for (const cell of covering) {
        ranges.push({ lower: key(cellid.rangeMin(cell)), upper: after(key(cellid.rangeMax(cell))) })
        for (let level = Math.min(cellid.level(cell) - 1, DOCUMENT_LEVEL); level >= 0; level--) {
            const parent = cellid.parent(cell, level)
            if (looked.has(parent)) break
            looked.add(parent)
            ranges.push({ lower: key(parent), upper: after(key(parent)) })
        }
    }
    return mergedRanges(ranges)
}

/**
 * Ranges sorted, the ones overlapping merged
 *
 * @param ranges
 */
function mergedRanges(ranges: GeoRange[]): GeoRange[] {
    ranges.sort((a, b) => Buffer.compare(a.lower, b.lower))
    const merged: GeoRange[] = []
    for (const range of ranges) {
        const last = merged[merged.length - 1]
        if (last && (!last.upper || Buffer.compare(range.lower, last.upper) <= 0)) {
            if (last.upper && (!range.upper || Buffer.compare(range.upper, last.upper) > 0)) last.upper = range.upper
        } else merged.push({ ...range })
    }
    return merged
}

/**
 * The ranges of the keys of a 2d index holding a box: the cells of its hashes (in the bits of the index) meeting it,
 * HASH_CELLS at most
 *
 * @param box
 * @param index
 * @param prefix
 * @param binary
 * @param after
 */
function hashRangesOf(box: { minX: number, minY: number, maxX: number, maxY: number }, index: EmbeddedIndex, prefix: Buffer, binary: (bytes: Buffer) => Buffer, after: (key: Buffer) => Buffer | undefined): GeoRange[] {
    const hashing = hashingOf(index)
    const size = hashing.max - hashing.min
    const minX = Math.max(box.minX, hashing.min)
    const minY = Math.max(box.minY, hashing.min)
    const maxX = Math.min(box.maxX, hashing.max)
    const maxY = Math.min(box.maxY, hashing.max)
    if (minX > maxX || minY > maxY) return []
    // The cells of a level: their indexes on the two axes
    let cells: [bigint, bigint][] = [[0n, 0n]]
    const found: [bigint, bigint, number][] = []
    let level = 0
    while (cells.length && level < hashing.bits) {
        const width = size / 2 ** level
        const partial: [bigint, bigint][] = []
        for (const [i, j] of cells) {
            const x0 = hashing.min + Number(i) * width
            const y0 = hashing.min + Number(j) * width
            if (x0 >= minX && x0 + width <= maxX && y0 >= minY && y0 + width <= maxY) found.push([i, j, level])
            else partial.push([i, j])
        }
        if (found.length + partial.length * 4 > HASH_CELLS) {
            for (const [i, j] of partial) found.push([i, j, level])
            cells = []
            break
        }
        cells = []
        const half = width / 2
        for (const [i, j] of partial)
            for (const [di, dj] of [[0n, 0n], [0n, 1n], [1n, 0n], [1n, 1n]]) {
                const x0 = hashing.min + Number(i * 2n + di) * half
                const y0 = hashing.min + Number(j * 2n + dj) * half
                if (x0 <= maxX && x0 + half >= minX && y0 <= maxY && y0 + half >= minY) cells.push([i * 2n + di, j * 2n + dj])
            }
        level++
    }
    for (const [i, j] of cells) found.push([i, j, level])
    const key = (hash: bigint) => Buffer.concat([prefix, binary(bytesOf(hash))])
    return mergedRanges(
        found.map(([i, j, depth]) => {
            let prefixBits = 0n
            for (let bit = BigInt(depth - 1); bit >= 0n; bit--) prefixBits = (prefixBits << 2n) | (((i >> bit) & 1n) << 1n) | ((j >> bit) & 1n)
            const free = BigInt(64 - 2 * depth)
            const low = prefixBits << free
            return { lower: key(low), upper: after(key(low | ((1n << free) - 1n))) }
        })
    )
}

/**
 * A $geoWithin, $within or $geoIntersects of a filter an index may serve: at its top level or in its top-level $and
 */
export interface GeoClause {
    path: string
    operator: string
    value: unknown
}

/**
 * The geo clauses of a filter at its top level or in its top-level $and (the documents matching the filter hold their
 * geometries)
 *
 * @param filter
 */
export function geoClausesOf(filter: EmbeddedDocument): GeoClause[] {
    const clauses: GeoClause[] = []
    for (const [key, value] of Object.entries(filter)) {
        if (key === '$and' && Array.isArray(value)) {
            for (const item of value) if (isDocument(item)) clauses.push(...geoClausesOf(item))
            continue
        }
        if (key.startsWith('$') || !isDocument(value)) continue
        for (const operator of ['$geoWithin', '$within', '$geoIntersects'])
            if (operator in value) clauses.push({ path: key, operator: operator, value: value[operator] })
    }
    return clauses
}

/**
 * The bounding box of a shape of a plane, or of a region of the sphere in degrees (undefined for a region crossing the
 * antimeridian or holding a pole: not a box)
 *
 * @param region
 */
function boxOf(region: GeoRegion | Rect): { minX: number, minY: number, maxX: number, maxY: number } | undefined {
    if (region instanceof Rect) {
        if (region.lng.isInverted() || region.lng.isFull()) return undefined
        const degrees = 180 / Math.PI
        return { minX: region.lng.lo * degrees, minY: region.lat.lo * degrees, maxX: region.lng.hi * degrees, maxY: region.lat.hi * degrees }
    }
    switch (region.kind) {
        case 'box':
            return region
        case 'flatPolygon':
            return {
                minX: Math.min(...region.points.map(([x]) => x)),
                minY: Math.min(...region.points.map(([, y]) => y)),
                maxX: Math.max(...region.points.map(([x]) => x)),
                maxY: Math.max(...region.points.map(([, y]) => y))
            }
        case 'circle':
            return { minX: region.x - region.radius, minY: region.y - region.radius, maxX: region.x + region.radius, maxY: region.y + region.radius }
        case 'cap':
            return boxOf(region.cap.rectBound())
        default:
            return boxOf(region.polygons.reduce((rect, polygon) => rect.union(polygon.rectBound()), Rect.emptyRect()))
    }
}

/**
 * The region of the sphere of a box of degrees (clipped to the bounds of the sphere), undefined when it is empty
 *
 * @param box
 */
function rectOf(box: { minX: number, minY: number, maxX: number, maxY: number }): Rect | undefined {
    const radians = Math.PI / 180
    const minY = Math.max(box.minY, -90)
    const maxY = Math.min(box.maxY, 90)
    const minX = Math.max(box.minX, -180)
    const maxX = Math.min(box.maxX, 180)
    if (minX > maxX || minY > maxY) return undefined
    return new Rect(new R1Interval(minY * radians, maxY * radians), S1Interval.fromEndpoints(minX * radians, maxX * radians))
}

/**
 * The ranges of the keys of a geo index holding the documents a geo clause may match (undefined when the index cannot
 * tell them: all of them then), after a prefix (the keys of the fields before its geo field)
 *
 * @param clause
 * @param kind the kind of the geo field of the index
 * @param index
 * @param prefix
 * @param binary
 * @param after
 */
export function geoRangesOf(clause: GeoClause, kind: GeoIndexKind, index: EmbeddedIndex, prefix: Buffer, binary: (bytes: Buffer) => Buffer, after: (key: Buffer) => Buffer | undefined): GeoRange[] | undefined {
    const intersects = clause.operator === '$geoIntersects'
    const region = intersects ? undefined : regionOf(clause.value)
    const shape = intersects ? intersectedOf(clause.value) : undefined
    if (kind === '2d') {
        // The locations of a plane: a shape of a plane by its box, the regions of the sphere by theirs
        const box = region ? boxOf(region) : boxOf(regionsOf(shape!).reduce<Rect>((rect, item) => rect.union(item instanceof Point ? Rect.fromLatLng(LatLng.fromPoint(item)) : (item as unknown as { rectBound(): Rect }).rectBound()), Rect.emptyRect()))
        return box && hashRangesOf(box, index, prefix, binary, after)
    }
    let regions: Region[]
    if (shape) regions = regionsOf(shape)
    else if (region!.kind === 'polygons') regions = region!.polygons
    else if (region!.kind === 'cap') regions = [region!.cap]
    else {
        const rect = rectOf(boxOf(region!)!)
        if (!rect) return []
        regions = [rect]
    }
    const covering = CellUnion.fromUnion(...regions.map((item) => QUERY_COVERER.covering(item)))
    return cellRangesOf([...covering], prefix, binary, after)
}

/**
 * The regions of the sphere of the parts of a shape
 *
 * @param shape
 */
function regionsOf(shape: GeoShape): Region[] {
    return partsOfShape(shape).flatMap((part): Region[] => {
        if (part.kind === 'point') return part.point ? [part.point] : []
        if (part.kind === 'line') return [part.line]
        return part.kind === 'polygon' ? [part.polygon] : []
    })
}

/**
 * A $near or a $nearSphere of a query (or the near of a $geoNear): the path of its field, its point (its coordinates,
 * on the sphere when its distances are), whether its distances are on the sphere (a GeoJSON point, $nearSphere,
 * spherical) and in meters (a GeoJSON point: else radians), or on a plane (a legacy $near: 2d), its minimum and maximum
 * distances (in its units)
 */
export interface EmbeddedNear {
    path: string
    x: number
    y: number
    point?: Point
    sphere: boolean
    meters: boolean
    min: number
    max: number
}

/**
 * A distance of a $near ($maxDistance, $minDistance): a number not negative
 *
 * @param value
 * @param name
 */
function distanceOf(value: unknown, name: string): number | undefined {
    if (value === undefined) return undefined
    const distance = numberOf(value)
    if (distance === undefined) throw badValue(`${name} must be a number`)
    if (!(distance >= 0)) throw badValue(`${name} must be non-negative`)
    return distance
}

/**
 * The point of a $near given as GeoJSON ($geometry: a Point) or as legacy coordinates
 *
 * @param value
 * @param sphere whether it is on the sphere (its bounds checked)
 */
function nearPointOf(value: unknown, sphere: boolean): { x: number, y: number, point?: Point, geoJSON: boolean } {
    if (isDocument(value) && 'type' in value) {
        if (value.type !== 'Point')
            throw badValue(`invalid point in geo near query $geometry argument: ${shown(value)}  Expected geojson geometry with type Point, but got type ${String(value.type)}`)
        const point = parsed(() => geoJSONPointOf(value.coordinates))
        return { x: point.x, y: point.y, point: point.point, geoJSON: true }
    }
    const [x, y] = parsed(() => pairOf(value))
    if (sphere && !onSphere(x, y)) throw badValue(`Longitude/latitude is out of bounds, lng: ${x} lat: ${y}`)
    return { x: x, y: y, point: onSphere(x, y) ? spherePoint(x, y) : undefined, geoJSON: false }
}

/**
 * The near of a field's condition with a $near or a $nearSphere (its siblings $maxDistance and $minDistance)
 *
 * @param path
 * @param condition
 */
function nearConditionOf(path: string, condition: EmbeddedDocument): EmbeddedNear {
    const operator = '$near' in condition ? '$near' : '$nearSphere'
    const value = condition[operator]
    const geometry = isDocument(value) && '$geometry' in value ? value.$geometry : undefined
    const point = nearPointOf(geometry ?? value, operator === '$nearSphere' || geometry !== undefined)
    const max = distanceOf((geometry !== undefined ? (value as EmbeddedDocument).$maxDistance : undefined) ?? condition.$maxDistance, '$maxDistance')
    const min = distanceOf((geometry !== undefined ? (value as EmbeddedDocument).$minDistance : undefined) ?? condition.$minDistance, '$minDistance')
    return {
        path: path,
        x: point.x,
        y: point.y,
        point: point.point,
        sphere: point.geoJSON || operator === '$nearSphere',
        meters: point.geoJSON,
        min: min ?? 0,
        max: max ?? Infinity
    }
}

/**
 * Whether a filter has a $geoWithin, a $within or a $geoIntersects anywhere
 *
 * @param value
 */
export function hasGeoQuery(value: unknown): boolean {
    if (Array.isArray(value)) return value.some(hasGeoQuery)
    if (!isDocument(value)) return false
    return Object.entries(value).some(([key, item]) => key === '$geoWithin' || key === '$within' || key === '$geoIntersects' || hasGeoQuery(item))
}

/**
 * Whether a filter has a $near or a $nearSphere anywhere (a $match of a pipeline, a count: not allowed)
 *
 * @param value
 */
export function hasNear(value: unknown): boolean {
    if (Array.isArray(value)) return value.some(hasNear)
    if (!isDocument(value)) return false
    return Object.entries(value).some(([key, item]) => key === '$near' || key === '$nearSphere' || hasNear(item))
}

/**
 * The $near (or $nearSphere) of a filter, where MongoDB 8.0 allows it: in a field's condition at its top level or in
 * its top-level $and, once (more fail with "Too many geoNear expressions"); elsewhere it fails with "geo $near must be
 * top-level expr". Undefined without one; else the near and the filter without it
 *
 * @param filter
 */
export function nearOf(filter: EmbeddedDocument): { near: EmbeddedNear, rest: EmbeddedDocument } | undefined {
    if (!hasNear(filter)) return undefined
    let found: EmbeddedNear | undefined
    let count = 0
    const without = (value: EmbeddedDocument, top: boolean): EmbeddedDocument => {
        const rest: EmbeddedDocument = {}
        for (const [key, item] of Object.entries(value)) {
            if (key === '$and' && top && Array.isArray(item)) {
                rest[key] = item.map((clause) => (isDocument(clause) ? without(clause, true) : clause))
                continue
            }
            if (!key.startsWith('$') && isDocument(item) && ('$near' in item || '$nearSphere' in item)) {
                count++
                found = nearConditionOf(key, item)
                const others = Object.fromEntries(Object.entries(item).filter(([name]) => !['$near', '$nearSphere', '$maxDistance', '$minDistance'].includes(name)))
                if (Object.keys(others).length) rest[key] = others
                if (Object.values(others).some(hasNear)) throw badValue('geo $near must be top-level expr')
                continue
            }
            if (hasNear(item)) throw badValue('geo $near must be top-level expr')
            rest[key] = item
        }
        return rest
    }
    const rest = without(filter, true)
    if (count > 1) throw badValue('Too many geoNear expressions')
    return found && { near: found, rest: rest }
}

/**
 * The near of a $geoNear stage, checked as MongoDB 8.0 checks its options, with its key (the field given, else the one
 * the indexes tell: keyOf), its query, its distance field, its multiplier and its field of the locations
 *
 * @param spec
 * @param keyOf the field of the near, from the indexes of the collection (when key is not given)
 */
export function geoNearOf(spec: unknown, keyOf: () => string): GeoNearOutput & { near: EmbeddedNear, query: EmbeddedDocument } {
    if (!isDocument(spec)) throw new EmbeddedOperationError(10065, 'Location10065', 'invalid parameter: expected an object ($geoNear)')
    for (const option of Object.keys(spec)) {
        if (option === 'num') throw new EmbeddedOperationError(50857, 'Location50857', "$geoNear no longer supports the 'num' parameter. Use a $limit stage instead.")
        if (option === 'limit') throw new EmbeddedOperationError(50858, 'Location50858', "$geoNear no longer supports the 'limit' parameter. Use a $limit stage instead.")
        if (!['near', 'distanceField', 'maxDistance', 'minDistance', 'query', 'spherical', 'distanceMultiplier', 'includeLocs', 'key', 'uniqueDocs'].includes(option))
            throw badValue(`Unknown argument to $geoNear: ${option}`)
    }
    if (spec.near === undefined) throw new EmbeddedOperationError(5860400, 'Location5860400', "$geoNear requires a 'near' argument")
    if (!Array.isArray(spec.near) && !isDocument(spec.near))
        throw new EmbeddedOperationError(5860401, 'Location5860401', '$geoNear requires near argument to be a GeoJSON object or a legacy point(array)')
    if (spec.distanceField === undefined) throw new EmbeddedOperationError(25278, 'Location25278', "$geoNear requires a 'distanceField' argument")
    if (typeof spec.distanceField !== 'string') throw new EmbeddedOperationError(16606, 'Location16606', "$geoNear requires that 'distanceField' option as a String")
    if (spec.includeLocs !== undefined && typeof spec.includeLocs !== 'string')
        throw new EmbeddedOperationError(16607, 'Location16607', "$geoNear requires that 'includeLocs' option is a String")
    if (spec.key !== undefined && (typeof spec.key !== 'string' || !spec.key))
        throw badValue("$geoNear parameter 'key' must be a non-empty string")
    const query = spec.query === undefined ? {} : spec.query
    if (!isDocument(query)) throw new EmbeddedOperationError(14, 'TypeMismatch', "$geoNear's query must be an object")
    if (hasNear(query)) throw badValue('Too many geoNear expressions')
    const max = spec.maxDistance === undefined ? undefined : numberOf(spec.maxDistance)
    if (spec.maxDistance !== undefined && (max === undefined || !(max >= 0))) throw badValue('maxDistance must be nonnegative')
    const min = spec.minDistance === undefined ? undefined : numberOf(spec.minDistance)
    if (spec.minDistance !== undefined && (min === undefined || !(min >= 0))) throw badValue('minDistance must be nonnegative')
    const multiplier = spec.distanceMultiplier === undefined ? 1 : numberOf(spec.distanceMultiplier)
    if (multiplier === undefined || !(multiplier >= 0)) throw badValue('distanceMultiplier must be a non-negative number')
    const geoJSON = isDocument(spec.near) && 'type' in spec.near
    let point: { x: number, y: number, point?: Point, geoJSON: boolean }
    try {
        point = nearPointOf(spec.near, geoJSON || !!spec.spherical)
    } catch {
        throw badValue('invalid argument in geo near query: type')
    }
    return {
        near: {
            path: spec.key ?? keyOf(),
            x: point.x,
            y: point.y,
            point: point.point,
            sphere: geoJSON || !!spec.spherical,
            meters: geoJSON,
            min: min ?? 0,
            max: max ?? Infinity
        },
        query: query,
        distanceField: spec.distanceField,
        multiplier: multiplier,
        includeLocs: spec.includeLocs
    }
}

/**
 * The distance of a document to a near, in the units of the near, and the location measured (the closest geometry of
 * its field; for a 2d field, the closest of its locations); undefined without one
 *
 * @param near
 * @param document
 * @param kind the kind of the index of the near
 */
export function nearDistanceOf(near: EmbeddedNear, document: EmbeddedDocument, kind: GeoIndexKind): { distance: number, radians: number, location: unknown } | undefined {
    let best: { distance: number, location: unknown } | undefined
    const keep = (distance: number, location: unknown) => {
        if (!best || distance < best.distance) best = { distance: distance, location: location }
    }
    for (const value of geoValuesAt(document, near.path.split('.'))) {
        if (kind === '2d') {
            let locations: { value: unknown, x: number, y: number }[]
            try {
                locations = flatLocationsOf(value)
            } catch {
                continue
            }
            for (const location of locations) {
                if (!near.sphere) keep(flatDistance(near.x, near.y, location.x, location.y), location.value)
                else if (onSphere(location.x, location.y)) keep(angleOf(near.point!.vector, spherePoint(location.x, location.y).vector), location.value)
            }
            continue
        }
        let shape: GeoShape | undefined
        try {
            shape = sphereShapeOf(value, near.path)
        } catch {
            continue
        }
        if (shape) keep(sphereDistance(near.point!, shape), value)
    }
    if (!best) return undefined
    if (!near.sphere) return { distance: best.distance, radians: best.distance, location: best.location }
    // Meters, or radians as MongoDB 8.0 gives them (from meters)
    const meters = best.distance * EARTH_RADIUS
    return { distance: near.meters ? meters : meters / EARTH_RADIUS, radians: best.distance, location: best.location }
}

/**
 * Whether a distance of a document is in the bounds of a near ($minDistance, $maxDistance); for a $nearSphere of a 2d
 * index, its location in the box of a plane MongoDB 8.0 reads it from (its rings of the plane, not across the
 * antimeridian: the latitudes within its distance, the longitudes within its distance widened by the latitude)
 *
 * @param near
 * @param found
 * @param kind
 */
export function nearHolds(near: EmbeddedNear, found: { distance: number, radians: number, location: unknown }, kind: GeoIndexKind): boolean {
    if (found.distance < near.min || found.distance > near.max) return false
    if (kind !== '2d' || !near.sphere) return true
    const [x, y] = pairOf(found.location)
    const degrees = (found.radians * 180) / Math.PI
    const scan = degrees / Math.min(Math.cos((Math.min(89, near.y + degrees) * Math.PI) / 180), Math.cos((Math.max(-89, near.y - degrees) * Math.PI) / 180))
    return Math.abs(y - near.y) <= degrees && Math.abs(x - near.x) <= scan
}

/**
 * The rings a $near reads in a 2dsphere index, from its point outwards: the ranges of the keys of the cells of each
 * ring not read yet, and its radius (radians: the documents closer are all read once it is)
 */
export class GeoRings {
    private radius = FIRST_RING
    private read: CellUnion = new CellUnion()
    private readonly looked = new Set<bigint>()
    private done = false
    private readonly limit: number

    /**
     * @param near
     * @param prefix the keys of the fields before its geo field
     * @param binary
     * @param after
     */
    constructor(private readonly near: EmbeddedNear, private readonly prefix: Buffer, private readonly binary: (bytes: Buffer) => Buffer, private readonly after: (key: Buffer) => Buffer | undefined) {
        const max = near.meters ? near.max / EARTH_RADIUS : near.max
        this.limit = Math.min(max, Math.PI)
    }

    /**
     * The next ring, undefined after the last one
     */
    next(): { ranges: GeoRange[], radius: number, last: boolean } | undefined {
        if (this.done) return undefined
        const radius = Math.min(this.radius, this.limit)
        const last = radius >= this.limit
        const covering = QUERY_COVERER.covering(Cap.fromCenterAngle(this.near.point!, last ? Math.min(this.limit * (1 + 1e-9) + 1e-12, Math.PI) : radius))
        const added = CellUnion.fromDifference(covering, this.read)
        this.read = CellUnion.fromUnion(this.read, covering)
        this.radius *= RING_GROWTH
        this.done = last
        return { ranges: cellRangesOf([...added], this.prefix, this.binary, this.after, this.looked), radius: radius, last: last }
    }
}

/**
 * The option of a $geoNear of a sub-pipeline ($lookup, $unionWith) the client gives it: the kind of the index of its
 * field, which it checked on the collection read (mingo then measures each document)
 */
export const GEO_NEAR_KIND = '$$geoNearKind'

/**
 * The options of a $geoNear stage giving its documents their distances and their locations
 */
export interface GeoNearOutput {
    distanceField: string
    multiplier: number
    includeLocs?: string
}

/**
 * A document of a $geoNear stage: its distance (times its multiplier) in its distance field, its location in its field
 * of the locations, given both as its metadata too ($meta geoNearDistance, geoNearPoint)
 *
 * @param document
 * @param distance
 * @param location
 * @param output
 */
export function geoNearResult<T extends EmbeddedDocument>(document: T, distance: number, location: unknown, output: GeoNearOutput): T {
    const set = (path: string, value: unknown) => {
        const steps = path.split('.')
        let target: EmbeddedDocument = document
        for (const step of steps.slice(0, -1)) {
            if (!isDocument(target[step])) target[step] = {}
            target = target[step]
        }
        target[steps[steps.length - 1]] = value
    }
    set(output.distanceField, distance * output.multiplier)
    if (output.includeLocs !== undefined) set(output.includeLocs, location)
    return withGeoNear(document, distance, location)
}

/**
 * The documents of a $geoNear stage measured one by one (in a sub-pipeline: mingo), in the order of their distances
 *
 * @param documents
 * @param spec its options, the kind of the index of its field given (GEO_NEAR_KIND)
 * @param matches the test of its query
 */
export function geoNearOfDocuments(documents: EmbeddedDocument[], spec: EmbeddedDocument, matches: (query: EmbeddedDocument) => (document: EmbeddedDocument) => boolean): EmbeddedDocument[] {
    const { [GEO_NEAR_KIND]: kind, ...options } = spec
    if (kind !== '2d' && kind !== '2dsphere')
        throw new EmbeddedOperationError(40603, 'Location40603', '$geoNear was not the first stage in the pipeline after optimization. Is optimization disabled or inhibited?')
    const stage = geoNearOf(options, () => options.key)
    const test = matches(stage.query)
    const found: { document: EmbeddedDocument, distance: number, radians: number, location: unknown }[] = []
    for (const document of documents) {
        if (!test(document)) continue
        const measured = nearDistanceOf(stage.near, document, kind)
        if (measured && nearHolds(stage.near, measured, kind)) found.push({ document: { ...document }, ...measured })
    }
    found.sort((a, b) => a.radians - b.radians || a.distance - b.distance)
    return found.map((item) => geoNearResult(item.document, item.distance, item.location, stage))
}

/**
 * A document given its distance and its location of a near ($meta geoNearDistance, geoNearPoint)
 *
 * @param document
 * @param distance
 * @param location
 */
export function withGeoNear<T>(document: T, distance: number, location: unknown): T {
    return setGeoNear(document, distance, location)
}
