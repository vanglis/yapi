import React from "react";
import { connect } from "react-redux";
import { Tabs, Layout, Spin } from "antd";
const { Content, Sider } = Layout;

import ErrMsg from "../../components/ErrMsg/ErrMsg.js";
import Header from "../../components/Header/Header.js";
import View from "../Project/Interface/InterfaceList/View.js";
import { setBreadcrumb } from "../../reducer/modules/user";
import { getProjectWithShare } from "../../reducer/modules/project.js";
import { fetchInterfaceDataWithShare } from "../../reducer/modules/interface.js";
import { setCurrGroupWithShare } from "../../reducer/modules/group.js";

import axios from "axios";

@connect(
  (state) => {
    return {
      loginState: state.user.loginState,
      curProject: state.project.currProject,
      currGroup: state.group.currGroup,
      curData: state.inter.curdata,
    };
  },
  {
    setBreadcrumb,
    fetchInterfaceData: fetchInterfaceDataWithShare,
    getProject: getProjectWithShare,
    setCurrGroup: setCurrGroupWithShare,
  }
)
class Share extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      loading: false,
      no_share: false,
    };
  }

  async componentWillMount() {
    this.setState({ loading: true });
    const shareId = this.props.match.params.id
    const res = await axios.get("/api/share/get", { params: { id: shareId } })

    const { errcode, errmsg, data } = res.data
    if (errcode == 0) {

      await this.props.fetchInterfaceData(data.interface_id, shareId);

      await this.props.getProject(data.project_id, shareId);

      await this.props.setCurrGroup({ _id: data.group_id, shareId });


      this.props.setBreadcrumb([
        { name: "分享" },
        {
          name: this.props.curData.title,
          href: `/project/${data.project_id}/interface/api/${data.interface_id}`,
        },
      ]);

      this.setState({ no_share: false})
    } else {
      this.setState({ no_share: true})
    }

    this.setState({ loading: false})
  }

  render() {
    return (
      <Layout>
        <Content
          style={{
            height: "100%",
            margin: "24px",
            overflow: "initial",
            backgroundColor: "#fff",
          }}
        >
          <div className="right-content">
            <Spin spinning={this.state.loading}>
              {this.state.loading ? "" : (this.state.no_share ? <ErrMsg type="noShare" /> : <View></View>)}
            </Spin>
          </div>
        </Content>
      </Layout>
    );
  }
}

export default Share;
