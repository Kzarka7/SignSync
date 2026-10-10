"""Geometry and missing-detection regression tests; no dataset needed."""
import unittest
import numpy as np
from prepare_handshape_experiments import handshape, resample_shape

class HandshapeTests(unittest.TestCase):
    def fixture(self):
        names=['wrist','thumb_tip']+[f+'_'+j for f in ('index','middle','ring','pinky') for j in ('mcp','pip','dip','tip')]
        order=[]
        for h in ('leftHand','rightHand'):
            order += [h+'.present']+[h+'.'+n+'.'+a for n in names for a in 'xy']
        x=np.zeros((1,len(order)))
        for h in ('leftHand','rightHand'):
            x[0,order.index(h+'.present')]=1
            for f in ('index','middle','ring','pinky'):
                for y,j in enumerate(('mcp','pip','dip','tip'),1): x[0,order.index(h+'.'+f+'_'+j+'.y')]=y
            x[0,order.index(h+'.thumb_tip.x')]=1
        return x,order

    def test_open_closed(self):
        x,o=self.fixture(); closed=x.copy()
        for h in ('leftHand','rightHand'):
            for f in ('index','middle','ring','pinky'):
                closed[0,o.index(h+'.'+f+'_dip.y')]=1.5
                closed[0,o.index(h+'.'+f+'_tip.y')]=1.1
        a,b=handshape(x,o),handshape(closed,o)
        self.assertEqual(a.shape,(1,26))
        self.assertTrue(np.all(a[:,2:6]>b[:,2:6]))
        self.assertTrue(np.all(a[:,6:10]<b[:,6:10]))

    def test_translation_and_scale(self):
        x,o=self.fixture(); y=x.copy()
        for i,n in enumerate(o):
            if n.endswith(('.x','.y')): y[:,i]=x[:,i]*3+2
        np.testing.assert_allclose(handshape(x,o),handshape(y,o),atol=1e-7)

    def test_missing_and_degenerate(self):
        x,o=self.fixture()
        for h in ('leftHand','rightHand'): x[:,o.index(h+'.present')]=0
        self.assertFalse(handshape(x,o).any())
        self.assertFalse(handshape(np.zeros_like(x),o).any())

    def test_no_geometry_across_missing_transition(self):
        v=np.zeros((2,26)); v[0]=1
        out=resample_shape(v,3)
        np.testing.assert_array_equal(out[0],v[0])
        self.assertFalse(out[1:].any())

if __name__=='__main__': unittest.main()
