const baseModel = require('./base.js');
const mongoose = require('mongoose')

class shareModel extends baseModel {
    getName() {
        return 'share';
    }

    getSchema() {
        return {
            group_id: { type: Number, required: true },
            project_id: { type: Number, required: true },
            interface_id: { type: Number, required: true },
        };
    }

    get(id) {
        return this.model.findOne({
            _id: id
        });
    }

    get_by_iid(interface_id) {
        return this.model.findOne({
            interface_id
        });
    }

    del(id) {
        return this.model.remove({
            _id: id
        });
    }

    save(data) {
        let s = new this.model(data);
        return s.save();
    }
}

module.exports = shareModel;
