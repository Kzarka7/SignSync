"""Synthetic checks for geometry and missing-observation handling."""
import unittest
import numpy as np
from gesture_geometry import geometry, resample, feature_names


class GeometryTests(unittest.TestCase):
    def setUp(self):
        self.order=[]
        self.values=[]
        for side in ('left','right'):
            for name,point in [('Elbow',(0,-1)),('Shoulder',(0,-2))]:
                for axis,value in zip('xy',point):
                    self.order.append(f'pose.{side}{name}.{axis}'); self.values.append(value)
                self.order.append(f'pose.{side}{name}.visibility'); self.values.append(1)
            self.order.append(side+'Hand.present'); self.values.append(1)
            points={'wrist':(0,0,0),'thumb_mcp':(-.5,.4,0),'thumb_ip':(-.7,.6,0),'thumb_tip':(-.9,.8,0)}
            for i,f in enumerate(('index','middle','ring','pinky')):
                x=(i-1)*.3
                for joint,y in (('mcp',1),('pip',1.5),('tip',2)):
                    points[f+'_'+joint]=(x,y,0)
            for name,point in points.items():
                for axis,value in zip('xyz',point):
                    self.order.append(f'{side}Hand.{name}.{axis}'); self.values.append(value)
        self.v=np.array([self.values],dtype=float)

    def test_missing_is_zero(self):
        for side in ('left','right'):
            self.v[:,self.order.index(side+'Hand.present')]=0
        self.assertFalse(geometry(self.v,self.order).any())
        self.assertFalse(resample(geometry(self.v,self.order),40).any())

    def test_translation_and_hand_scale(self):
        original=geometry(self.v,self.order)
        shifted=self.v.copy()
        for j,name in enumerate(self.order):
            if name.endswith('.x'): shifted[:,j]+=7
            if name.endswith('.y'): shifted[:,j]-=4
        np.testing.assert_allclose(geometry(shifted,self.order),original,atol=1e-12)
        enlarged=self.v.copy()
        for j,name in enumerate(self.order):
            if name.endswith(('.x','.y','.z')): enlarged[:,j]*=2
        result=geometry(enlarged,self.order)
        for offset in (0,14):
            np.testing.assert_allclose(result[:,offset:offset+13],original[:,offset:offset+13],atol=1e-12)

    def test_no_interpolation_across_missing(self):
        valid=geometry(self.v,self.order)
        sequence=np.concatenate([np.zeros_like(valid),valid,valid])
        out=resample(sequence,5)
        self.assertFalse(out[:2,:28].any())
        np.testing.assert_allclose(out[:,28:34],np.tile(valid[:,:6],(5,1)))
        self.assertEqual(out.shape,(5,len(feature_names())))

    def test_palm_normal_reverses_with_winding(self):
        before=geometry(self.v,self.order)
        for side in ('left','right'):
            for axis in 'xyz':
                a=self.order.index(f'{side}Hand.index_mcp.{axis}')
                b=self.order.index(f'{side}Hand.pinky_mcp.{axis}')
                self.v[:,[a,b]]=self.v[:,[b,a]]
        after=geometry(self.v,self.order)
        np.testing.assert_allclose(after[:,7:10],-before[:,7:10])

    def test_thumb_spread_and_wrist_bend_are_measured(self):
        before=geometry(self.v,self.order)
        self.v[:,self.order.index('leftHand.thumb_tip.x')]=-1.8
        self.v[:,self.order.index('pose.leftElbow.x')]=-1
        self.v[:,self.order.index('pose.leftElbow.y')]=0
        after=geometry(self.v,self.order)
        self.assertGreater(after[0,1],before[0,1])
        self.assertLess(after[0,2],before[0,2])
        self.assertAlmostEqual(before[0,11],1)
        self.assertAlmostEqual(after[0,11],0)
        self.assertAlmostEqual(after[0,12],1)

    def test_low_pose_visibility_does_not_erase_handshape(self):
        self.v[:,self.order.index('pose.leftElbow.visibility')]=0
        result=geometry(self.v,self.order)
        self.assertEqual(result[0,0],1)
        self.assertEqual(result[0,6],1)
        self.assertFalse(result[0,10:14].any())


if __name__=='__main__': unittest.main()
