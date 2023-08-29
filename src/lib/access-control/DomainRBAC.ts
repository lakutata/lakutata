import {Model as CasbinModel} from 'casbin/lib/cjs/model/model'

export class DomainRBAC extends CasbinModel {
    constructor() {
        super()
        this.addDef('r', 'r', 'sub, dom, obj, act')
        this.addDef('p', 'p', 'sub, dom, obj, act')
        this.addDef('g', 'g', '_, _, _')
        this.addDef('e', 'e', 'some(where (p.eft == allow))')
        this.addDef('m', 'm', 'g(r.sub, p.sub, r.dom) && r.dom == p.dom && r.obj == p.obj && r.act == p.act')
    }
}
