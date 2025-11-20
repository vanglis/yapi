import React, { PureComponent as Component } from 'react';
import { Form, Input, Button, message } from 'antd';
import axios from 'axios';
import { List } from 'antd';

const FormItem = Form.Item;

export default class Config extends Component {
  state = {
    config: {
      jarPath: '',
      templatePath: '',
      outDir: '',
      additionalProperties: ''
    },
    loading: false
    , archives: []
  };

  async componentDidMount() {
    this.fetchConfig();
    this.fetchArchives();
  }

  fetchConfig = async () => {
    try {
      const res = await axios.get('/api/plugin/gen-code/config');
      if (res.data.errcode === 0) {
        this.setState({ config: res.data.data.config || {} });
      } else {
        message.error(res.data.errmsg || '读取配置失败');
      }
    } catch (e) {
      message.error(e.message);
    }
  };

  fetchArchives = async () => {
    try {
      const res = await axios.get('/api/plugin/gen-code/archives');
      if (res.data.errcode === 0) {
        this.setState({ archives: res.data.data.archives || [] });
      }
    } catch (e) {}
  };

  save = async () => {
    this.setState({ loading: true });
    try {
  const res = await axios.post('/api/plugin/gen-code/config/save', this.state.config);
      if (res.data.errcode === 0) {
        message.success('保存成功');
      } else {
        message.error(res.data.errmsg || '保存失败');
      }
    } catch (e) {
      message.error(e.message);
    } finally {
      this.setState({ loading: false });
    }
  };

  render() {
    const { config, loading } = this.state;
    return (
      <div className="plugin-gen-code-config" style={{ padding: 16 }}>
        <h3>生成代码插件配置</h3>
        <Form layout="vertical">
          <FormItem label="openapi-generator jar 路径">
            <Input value={config.jarPath || ''} onChange={e => this.setState({ config: {...config, jarPath: e.target.value }})} />
          </FormItem>
          <FormItem label="自定义模板路径 (可选)">
            <Input value={config.templatePath || ''} onChange={e => this.setState({ config: {...config, templatePath: e.target.value }})} />
          </FormItem>
          <FormItem label="默认输出目录 (可选)">
            <Input value={config.outDir || ''} onChange={e => this.setState({ config: {...config, outDir: e.target.value }})} />
          </FormItem>
          <FormItem label="additionalProperties (逗号分隔)">
            <Input value={config.additionalProperties || ''} onChange={e => this.setState({ config: {...config, additionalProperties: e.target.value }})} />
          </FormItem>

          <FormItem>
            <Button type="primary" loading={loading} onClick={this.save}>保存</Button>
            <Button style={{ marginLeft: 8 }} onClick={this.fetchConfig}>刷新</Button>
            <Button style={{ marginLeft: 8 }} onClick={this.fetchArchives}>刷新下载</Button>
          </FormItem>
        </Form>

        <h3 style={{ marginTop: 24 }}>生成产物下载</h3>
        <div>
          <List
            itemLayout="horizontal"
            dataSource={this.state.archives}
            renderItem={item => (
              <List.Item actions={[<a key="download" href={item.url} target="_blank" rel="noopener noreferrer">下载</a>] }>
                <List.Item.Meta
                  title={item.name}
                  description={new Date(item.mtime).toLocaleString()}
                />
              </List.Item>
            )}
          />
        </div>
      </div>
    );
  }
}
