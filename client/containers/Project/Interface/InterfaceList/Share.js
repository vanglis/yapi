import React from "react"
import { connect } from 'react-redux';
import { Table, Icon, Row, Col, Tooltip, message, Button, Input,Popconfirm } from 'antd';
import { Link, withRouter } from 'react-router-dom';
import axios from 'axios'
import { autobind } from 'core-decorators';
import copy from 'copy-to-clipboard';

@connect(state => {
    return {
        curProject: state.project.currProject,
        currGroup: state.group.currGroup,
        curData: state.inter.curdata,
    };
})
@withRouter
class Share extends React.Component {
    constructor(props) {
        super(props)

        this.state = {
            url: '',
            share_id: '',
            isShare: /^\/share/i.test(this.props.location.pathname)
        }
    }

    componentDidMount() {
        this.doCheckShare(this.props.curData._id)
    }

    componentWillReceiveProps(nextProp) {
        this.doCheckShare(nextProp.curData._id)
    }

    @autobind
    doCheckShare(interface_id) {
        if(this.state.isShare) {
            return
        }
        axios.get('/api/share/get_by_iid', {
            params: {
                interface_id
            }
        }).then(res => {
            const { errcode, errmsg, data } = res.data

            this.setState({ share_id: errcode == 0 ? data._id : '' })
        })
    }

    @autobind
    doAddShare() {
        axios.post('/api/share/add', {
            group_id: this.props.currGroup._id,
            project_id: this.props.curProject._id,
            interface_id: this.props.curData._id
        }).then(res => {
            const { errcode, errmsg, data } = res.data
            if (errcode == 0) {
                this.setState({ share_id: data._id })
            } else {
                message.error(errmsg || '操作失败');
            }
        })
    }

    @autobind
    doDelShare() {
        axios.get('/api/share/del', {
            params: {
                id: this.state.share_id
            }
        }).then(res => {
            const { errcode, errmsg, data } = res.data
            if (errcode == 0) {
                this.setState({ share_id: "" })
            } else {
                message.error(errmsg || '操作失败');
            }
        })
    }

    @autobind
    getShareUrl() {
        const url = new URL(location.href)
        url.pathname = `/share/${this.state.share_id}`
        return url.href
    }

    @autobind
    copyUrl() {
        copy(this.getShareUrl());
        message.success('已经成功复制到剪切板');
    };

    @autobind
    openUrl() {
        window.open(this.getShareUrl(), "_blank")
    }

    render() {
        if (this.state.isShare) {
            return ''
        }

        return (
            <Row className="row">
                <Col span={4} className="colKey">
                    分享：
                </Col>

                {this.state.share_id ? (
                    <Col span={18} className="colValue">
                        <span className="href mr-10" onClick={this.openUrl}>{this.getShareUrl()}</span>
                        <Button type="primary" size="small" className="mr-10" onClick={this.copyUrl}>复制</Button>
                        <Button type="danger" size="small" onClick={this.doDelShare}>取消</Button>

                    </Col>
                ) : (
                    <Col span={18} className="colValue">
                        <Popconfirm
                            title="分享后，任何人都能看到API信息，是否继续?"
                            onConfirm={this.doAddShare}
                            okText="确定"
                            cancelText="取消"
                        >
                            <Button type="primary" size="small">生成分享</Button>
                        </Popconfirm>
                    </Col>
                )}


            </Row>
        )
    }
}


export default Share;
