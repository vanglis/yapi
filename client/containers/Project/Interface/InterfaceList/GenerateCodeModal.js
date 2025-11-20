import React, { PureComponent as Component } from 'react';
import PropTypes from 'prop-types';
import { Modal, Form, Select, Button, Input, message } from 'antd';
import axios from 'axios';

const FormItem = Form.Item;
const Option = Select.Option;

class GenerateCodeModal extends Component {
  static propTypes = {
    visible: PropTypes.bool,
    onCancel: PropTypes.func,
    onClose: PropTypes.func,
    projectId: PropTypes.string,
    interfaceList: PropTypes.array,
  };

  state = {
    language: 'spring',
    template: 'default',
    scope: 'all',
    selectedInterfaces: [],
    projectName: '',
    multiModule: true,
    running: false,
    taskId: null,
    openapiUrl: null,
      logs: '',
    offset: 0
      ,
      // download info populated from task polling
      downloadUrl: null,
      downloadName: null
    };

  downloadRef = React.createRef();

  handleSubmit = () => {
    // start generation: call backend and then poll logs
    const { language, template, scope, selectedInterfaces, projectName, multiModule } = this.state;
    const payload = {
      projectId: this.props.projectId,
      language,
      template,
      scope,
      selectedInterfaces,
      projectName,
      multiModule
    };

    this.setState({ running: true, logs: '', offset: 0 });
    axios.post('/api/plugin/gen-code/generate', payload).then(res => {
      if (res.data && res.data.errcode === 0) {
        const data = res.data.data || {};
        const taskId = data.taskId;
        const openapiUrl = data.openapiUrl;
        this.setState({ taskId, openapiUrl }, () => {
          // start polling
          this.pollTimer = setInterval(this.pollLogs.bind(this), 1500);
        });
      } else {
        message.error(res.data && res.data.errmsg ? res.data.errmsg : '生成任务创建失败');
        this.setState({ running: false });
      }
    }).catch(err => {
      message.error(err.message || '请求失败');
      this.setState({ running: false });
    });
  };

  componentWillUnmount() {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  async pollLogs() {
    const { taskId, offset } = this.state;
    if (!taskId) return;
    try {
      const res = await axios.get('/api/plugin/gen-code/task', { params: { taskId, offset } });
      if (res.data && res.data.errcode === 0) {
        const d = res.data.data || {};
        const newLog = d.log || '';
        const newOffset = d.offset || offset;
        const task = d.task || {};
        if (newLog) {
          this.setState(prev => ({ logs: prev.logs + newLog }));
        }
        // update offset and download info if available
        const update = { offset: newOffset };
        if (task.downloadUrl) {
          update.downloadUrl = task.downloadUrl;
          update.downloadName = task.downloadName || (task.downloadUrl && task.downloadUrl.split('/').pop());
        }
        this.setState(update);
        if (task.status === 'failed') {
          // final poll: append any remaining log then stop
          if (this.pollTimer) clearInterval(this.pollTimer);
          this.setState({ running: false });
          message.error('生成失败，请查看日志');
        } else if (task.status === 'success') {
          // generation finished; backend may still be creating archive asynchronously.
          // do a short post-success polling to wait for downloadUrl to appear.
          if (this.pollTimer) clearInterval(this.pollTimer);
          this.setState({ running: false });
          // try up to N times to fetch downloadUrl
          const maxAttempts = 6; // try up to ~6 seconds
          let attempts = 0;
          const waitForDownload = async () => {
            try {
              const r2 = await axios.get('/api/plugin/gen-code/task', { params: { taskId, offset: this.state.offset } });
              if (r2.data && r2.data.errcode === 0) {
                const task2 = (r2.data.data && r2.data.data.task) || {};
                if (task2.downloadUrl) {
                  this.setState({ downloadUrl: task2.downloadUrl, downloadName: task2.downloadName || (task2.downloadUrl && task2.downloadUrl.split('/').pop()) });
                  try { message.success('生成完成，下载已准备就绪'); } catch (e) {}
                  // scroll to download area
                  try { if (this.downloadRef && this.downloadRef.current) this.downloadRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
                  return;
                }
              }
            } catch (e) {
              // ignore
            }
            attempts++;
            if (attempts < maxAttempts) {
              setTimeout(waitForDownload, 1000);
            } else {
              try { message.warning('生成已完成，但未检测到下载链接（可能稍后可用）'); } catch (e) {}
            }
          };
          waitForDownload();
        }
      }
    } catch (e) {
      // ignore transient errors
    }
  }

  render() {
  const { visible, onCancel, interfaceList } = this.props;
  const { language, template, scope, selectedInterfaces, projectName, multiModule, running, logs, openapiUrl } = this.state;

    const modalStyle = { maxWidth: 820 };

    return (
      <Modal
        title="生成代码配置"
        visible={visible}
        onCancel={onCancel}
        width={780}
        bodyStyle={{ padding: '24px 28px' }}
        wrapClassName="gen-code-config-modal"
        footer={[
          <Button key="cancel" onClick={() => { if (this.pollTimer) clearInterval(this.pollTimer); onCancel && onCancel(); }}>
            取消
          </Button>,
          <Button key="submit" type="primary" onClick={this.handleSubmit} loading={running} disabled={running}>
            {running ? '生成中...' : '开始生成'}
          </Button>
        ]}
      >
        <div style={{ marginBottom: 12, color: 'rgba(0,0,0,0.65)' }}>
          说明：在此页面可选择生成语言、模板与范围。部分生成时，可从下方列表选择若干接口。
        </div>

        <Form layout="vertical">
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <FormItem label="语言类型">
                <Select
                  value={language}
                  onChange={(value) => this.setState({ language: value })}
                >
                  <Option value="java">Java</Option>
                  <Option value="spring">Spring</Option>
                </Select>
              </FormItem>

              <FormItem label="生成范围">
                <Select
                  value={scope}
                  onChange={(value) => this.setState({ scope: value })}
                >
                  <Option value="all">生成全部接口</Option>
                  <Option value="partial">生成部分接口</Option>
                  <Option value="tag">通过标签筛选</Option>
                </Select>
              </FormItem>
            </div>

            <div style={{ flex: 1 }}>
              <FormItem label="代码模板">
                <Select
                  value={template}
                  onChange={(value) => this.setState({ template: value })}
                >
                  <Option value="default">默认模板</Option>
                  <Option value="custom">自定义模板</Option>
                </Select>
              </FormItem>

              {scope === 'partial' && (
                <FormItem label="接口范围">
                  <Select
                    mode="multiple"
                    value={selectedInterfaces}
                    onChange={(value) => this.setState({ selectedInterfaces: value })}
                    placeholder="请选择要生成的接口"
                  >
                    {interfaceList.map((item) => (
                      <Option key={item._id} value={item._id}>
                        {item.title}
                      </Option>
                    ))}
                  </Select>
                </FormItem>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <FormItem label="项目名称（可选）" extra="用于多模块命名，例如：dip-odmp-fc → dip-odmp-fc-boot / business / present / api；留空则使用默认名">
                <Input
                  value={projectName}
                  onChange={(e) => this.setState({ projectName: e.target.value })}
                  placeholder="例如：dip-odmp-fc"
                />
              </FormItem>
            </div>
            <div style={{ flex: 1 }}>
              <FormItem label="多模块结构">
                <Select
                  value={multiModule}
                  onChange={(value) => this.setState({ multiModule: value })}
                >
                  <Option value={true}>启用（boot + business + present + api）</Option>
                  <Option value={false}>禁用（单模块）</Option>
                </Select>
              </FormItem>
            </div>
          </div>
        </Form>

        {openapiUrl && (
          <div style={{ marginTop: 12 }}>
            <b>OpenAPI 预览：</b>
            <div style={{ display: 'flex', alignItems: 'center', marginTop: 6 }}>
              <a href={openapiUrl} target="_blank" rel="noopener noreferrer" style={{ marginRight: 8 }}>{openapiUrl}</a>
              <Button size="small" onClick={() => {
                try {
                  const el = document.createElement('textarea');
                  el.value = openapiUrl;
                  document.body.appendChild(el);
                  el.select();
                  document.execCommand('copy');
                  document.body.removeChild(el);
                  message.success('链接已复制到剪贴板');
                } catch (e) {
                  message.error('复制失败：' + e.message);
                }
              }}>复制</Button>
            </div>
          </div>
        )}

        {/* 下载区域：放在 OpenAPI 预览模块下方，另起一行 */}
        <div ref={this.downloadRef} style={{ marginTop: 12 }}>
          {this.state.downloadUrl ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <a href={this.state.downloadUrl} target="_blank" rel="noopener noreferrer" download={this.state.downloadName}>
                <Button type="primary">下载代码</Button>
              </a>
              <span style={{ color: '#666' }}>{this.state.downloadName || ''}</span>
            </div>
          ) : (
            <div style={{ color: '#999' }}>若已生成，下载链接会在此处显示</div>
          )}
        </div>

        <div style={{ marginTop: 14 }}>
          <b>实时日志：</b>
          <div style={{ marginTop: 8, maxHeight: '40vh', overflow: 'auto', background: '#fafafa', padding: 12, border: '1px solid #eee', borderRadius: 4 }}>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{logs || (running ? '等待生成启动...' : '尚未生成')}</pre>
          </div>
        </div>
      </Modal>
    );
  }
}

export default GenerateCodeModal;