import { Button, Dropdown, Menu } from 'antd';
import { DownOutlined, UserOutlined } from '@ant-design/icons';

const Home = () => {
  const cityMenu = (
    <Menu className="bg-white dark:bg-gray-700 z-50">
      <Menu.Item key="1">New York, NY</Menu.Item>
      <Menu.Item key="2">Los Angeles, CA</Menu.Item>
      <Menu.Item key="3">Chicago, IL</Menu.Item>
      <Menu.Item key="4">Houston, TX</Menu.Item>
      <Menu.Item key="5">Phoenix, AZ</Menu.Item>
      <Menu.Item key="6">Philadelphia, PA</Menu.Item>
      <Menu.Item key="7">San Antonio, TX</Menu.Item>
      <Menu.Item key="8">San Diego, CA</Menu.Item>
      <Menu.Item key="9">Dallas, TX</Menu.Item>
      <Menu.Item key="10">San Jose, CA</Menu.Item>
    </Menu>
  );

  return <div>
   <h2> Welcome to the Home Page</h2>
   <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
     <Button type="primary" icon={<UserOutlined />}>Know More</Button>
     <Dropdown overlay={cityMenu} trigger={['click']}>
       <Button>
         Largest US Cities <DownOutlined />
       </Button>
     </Dropdown>
   </div>
    </div>;
};  

export default Home;