import React from 'react';
import { autobind } from 'core-decorators';
import { Button, Modal, Input, Row, Col, message } from 'antd';
import { connect } from 'react-redux';
import { regActions } from '../../reducer/modules/user';

@connect(
    state => {
        return {
            role: state.user.role,
        };
    },
    {
        regActions
    }
)
class Add extends React.Component {

    state = {
        visible: false,
        name: false,
        email: false,
        pwd: false,
    }
    constructor(props) {
        super(props)
    }

    @autobind
    showModal() {
        this.setState({
            email: '',
            name: '',
            pwd: '',
            visible: true
        });
    }

    @autobind
    hideModal() {
        this.setState({
            visible: false
        });
    }

    @autobind
    addUser() {
        const { email, name, pwd } = this.state
        if (email && name && pwd) {
            if (!(/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{1,})+$/.test(email))) {
                message.error('邮箱不合法')
                return
            }

            this.props.regActions({
                action: 'append',
                userName: name,
                password: pwd,
                email: email
            }).then(res => {
                if (res.payload.data.errcode == 0) {
                    message.success('添加成功! ');
                    this.props.onSuccess();
                    this.setState({ visible: false });
                }
            });
        } else {
            message.error('请填写完整')
        }
    }

    @autobind
    inputName(e) {
        this.setState({ name: e.target.value });
    }

    @autobind
    inputEmail(e) {
        this.setState({ email: e.target.value });
    }

    @autobind
    inputPwd(e) {
        this.setState({ pwd: e.target.value });
    }
    render() {
        if (this.props.role === 'admin') {
            return (
                <Row>
                    <Button type="primary" onClick={this.showModal}>添加用户</Button>
                    <Modal
                        title="添加用户"
                        visible={this.state.visible}
                        onOk={this.addUser}
                        onCancel={this.hideModal}
                        className="add-group-modal"
                    >
                        <Row gutter={6} className="modal-input">
                            <Col span="5">
                                <div className="label">用户名：</div>
                            </Col>
                            <Col span="15">
                                <Input placeholder="请输入用户名" onChange={this.inputName} />
                            </Col>
                        </Row>
                        <Row gutter={6} className="modal-input">
                            <Col span="5">
                                <div className="label">邮箱：</div>
                            </Col>
                            <Col span="15">
                                <Input rows={3} placeholder="请输入邮箱" onChange={this.inputEmail} />
                            </Col>
                        </Row>
                        <Row gutter={6} className="modal-input">
                            <Col span="5">
                                <div className="label">密码：</div>
                            </Col>
                            <Col span="15">
                                <Input rows={3} type="password" placeholder="请输入默认密码" onChange={this.inputPwd} />
                            </Col>
                        </Row>

                    </Modal>
                </Row>
            )
        }
        return ""
    }
}

export default Add
