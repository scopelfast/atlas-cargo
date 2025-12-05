/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * <p>This source code is licensed under the MIT license found in the LICENSE file in the root
 * directory of this source tree.
 */
package com.divulgacarga.motorista;

import android.content.Context;
import com.facebook.react.ReactInstanceManager;

/** Class responsible of loading Flipper inside your React Native application. */
public class ReactNativeFlipper {
  public static void initializeFlipper(Context context, ReactInstanceManager reactInstanceManager) {
    // Do nothing as we don't want Flipper in release mode
  }
}

