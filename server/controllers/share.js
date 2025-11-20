const yapi = require('../yapi.js');
const baseController = require('./base.js');
const shareModel = require('../models/share.js');

class shareController extends baseController {
    constructor(ctx) {
        super(ctx);
        this.Model = yapi.getInst(shareModel);
    }

    async add(ctx) {
        const { group_id, project_id, interface_id } = ctx.params
        try {
            if (!group_id || !project_id || !interface_id) {
                throw new Error('参数错误')
            }
            let result = await this.Model.save({ group_id, project_id, interface_id });
            ctx.body = yapi.commons.resReturn(result);
        } catch (e) {
            ctx.body = yapi.commons.resReturn(null, 401, e.message);
        }
    }

    async get(ctx) {
        const { id } = ctx.params
        try {
            let result = await this.Model.get(id);
            ctx.body = yapi.commons.resReturn(result.toObject());
        } catch (e) {
            ctx.body = yapi.commons.resReturn(null, 401, e.message);
        }
    }

    async get_by_iid(ctx) {
        const { interface_id } = ctx.params
        try {
            let result = await this.Model.get_by_iid(interface_id);
            ctx.body = yapi.commons.resReturn(result.toObject());
        } catch (e) {
            ctx.body = yapi.commons.resReturn(null, 401, e.message);
        }
    }

    async del(ctx) {
        const { id } = ctx.params
        try {
            let result = await this.Model.del(id);
            ctx.body = yapi.commons.resReturn(result);
        } catch (e) {
            ctx.body = yapi.commons.resReturn(null, 401, e.message);
        }
    }
}
module.exports = shareController;
