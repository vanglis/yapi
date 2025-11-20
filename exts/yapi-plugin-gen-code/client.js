import Config from './Config/Config.js';

function genCodeConfig(routers) {
  routers['gen_code_config'] = {
    name: '生成代码配置',
    component: Config
  };
}

module.exports = function() {
  this.bindHook('sub_setting_nav', genCodeConfig);
};
