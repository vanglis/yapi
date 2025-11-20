const controller = require('./controller');

module.exports = function() {
  this.bindHook('add_router', function(addRouter) {
  // 开始生成（创建异步任务）-> 注册路由 /api/plugin/gen-code/generate
    addRouter({
      controller: controller,
      method: 'post',
      prefix: '',
      path: 'gen-code/generate',
      action: 'generateCode'
    });

  // 获取任务状态/日志 -> /api/plugin/gen-code/task
    addRouter({
      controller: controller,
      method: 'get',
      prefix: '',
      path: 'gen-code/task',
      action: 'getTask'
    });

  // 获取插件配置 -> /api/plugin/gen-code/config
    addRouter({
      controller: controller,
      method: 'get',
      prefix: '',
      path: 'gen-code/config',
      action: 'getConfig'
    });

  // 设置插件配置 -> /api/plugin/gen-code/config/save
    addRouter({
      controller: controller,
      method: 'post',
      prefix: '',
      path: 'gen-code/config/save',
      action: 'setConfig'
    });
  });
};
